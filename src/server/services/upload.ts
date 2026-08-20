import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { extractNormalizedExif, type CoarseLocation } from "@/src/domain/exif";
import { assessMemoryImportance } from "@/src/domain/memory-assessment";
import {
  sha256Hex,
  validateImageBytes,
  type SupportedImageMime,
} from "@/src/domain/media-validation";
import {
  clusterTemporalSequences,
  selectRepresentativeAssets,
  type SequenceAsset,
} from "@/src/domain/sequence";
import type { RuntimeConfig } from "@/src/server/config";
import type { SelectedPlace } from "@/src/domain/place";
import { RepositoryError } from "@/src/server/services/memories";

type Client = SupabaseClient;

interface StoredAsset {
  id: string;
  name: string;
  mimeType: SupportedImageMime;
  capturedAt: string | null;
  capturedAtLocal: string | null;
  timezoneOffset: string | null;
  coarsePlace: string | null;
  sha256: string;
  width: number;
  height: number;
  derivative: Buffer;
  derivativeWidth: number;
  derivativeHeight: number;
  originalStorageKey: string;
  derivativeStorageKey: string | null;
  analysisStatus:
    | "pending"
    | "processing"
    | "complete"
    | "failed"
    | "not_supported";
  updatedAt: string | null;
  isDuplicate: boolean;
  uploadSlotId: string | null;
}

interface RejectedAsset {
  name: string;
  reason: string;
  slotId?: string;
}

export interface IngestionResult {
  accepted: Array<{
    id: string;
    slotId?: string;
    name: string;
    capturedAt: string | null;
    state: "uploaded" | "processing" | "partial" | "ready";
  }>;
  rejected: RejectedAsset[];
  sequenceIds: string[];
  processingState: "uploaded" | "processing" | "partial" | "failed" | "ready";
  message: string;
  sequences: Array<{
    sequenceId: string;
    memoryId: string;
    analysisCandidates: StoredAsset[];
  }>;
  retainedOriginalStorageKeys: string[];
}

export interface IngestionFile {
  name: string;
  load: () => Promise<File>;
  stagedOriginalKey?: string;
  reservedAssetId?: string;
  uploadSlotId?: string;
}

export async function ingestUpload(input: {
  client: Client;
  userId: string;
  files: IngestionFile[];
  config: RuntimeConfig;
  timezoneOffsetMinutes: number | null;
  coarsePlace?: string | null;
  selectedPlace?: SelectedPlace | null;
  resolveCoarseLocation?: (location: CoarseLocation) => Promise<string | null>;
}): Promise<IngestionResult> {
  const { client, userId, config } = input;
  const preferenceResult = await client
    .from("user_preferences")
    .select("use_photos,use_captured_at,use_location,memory_map_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (preferenceResult.error !== null)
    throw new RepositoryError("upload_preferences");
  const preferences = {
    usePhotos: preferenceResult.data?.use_photos !== false,
    useCapturedAt: preferenceResult.data?.use_captured_at !== false,
    useLocation: preferenceResult.data?.use_location === true,
    useMemoryMap: preferenceResult.data?.memory_map_enabled === true,
  };

  const stored: StoredAsset[] = [];
  const rejected: RejectedAsset[] = [];
  for (const source of input.files.slice(0, config.upload.maxFiles)) {
    try {
      const file = await source.load();
      const result = await validateAndStoreAsset({
        client,
        userId,
        file,
        stagedOriginalKey: source.stagedOriginalKey ?? null,
        reservedAssetId: source.reservedAssetId ?? null,
        uploadSlotId: source.uploadSlotId ?? null,
        config,
        preferences,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        coarsePlace: input.coarsePlace ?? null,
        resolveCoarseLocation: input.resolveCoarseLocation,
      });
      stored.push(result);
    } catch (error) {
      rejected.push({
        name: source.name,
        ...(source.uploadSlotId === undefined
          ? {}
          : { slotId: source.uploadSlotId }),
        reason:
          error instanceof UploadValidationError
            ? error.publicMessage
            : "画像を安全に処理できませんでした。",
      });
    }
  }
  if (input.files.length > config.upload.maxFiles) {
    input.files.slice(config.upload.maxFiles).forEach(({ name }) => {
      rejected.push({
        name,
        reason: `一度に追加できる写真は${config.upload.maxFiles}枚までです。`,
      });
    });
  }

  // A failed deterministic write deliberately leaves the safely stored asset in
  // place. Include those duplicate-but-unlinked rows on a retry so the exact
  // same bytes can still become a Sequence/Event/Memory.
  const uniqueStored = [
    ...new Map(stored.map((asset) => [asset.id, asset])).values(),
  ];
  const linkedIds = new Set<string>();
  const sequenceByAssetId = new Map<string, string>();
  if (uniqueStored.length > 0) {
    const linked = await client
      .from("sequence_assets")
      .select("asset_id,sequence_id")
      .eq("user_id", userId)
      .in(
        "asset_id",
        uniqueStored.map(({ id }) => id),
      );
    if (linked.error !== null)
      throw new RepositoryError("existing_sequence_membership");
    (linked.data ?? []).forEach(({ asset_id, sequence_id }) => {
      linkedIds.add(asset_id);
      sequenceByAssetId.set(asset_id, sequence_id);
    });
  }
  const unlinked = uniqueStored.filter(({ id }) => !linkedIds.has(id));
  const domainAssets: SequenceAsset[] = unlinked.map((asset) => ({
    id: asset.id,
    capturedAt: asset.capturedAt,
    capturedAtLocal: asset.capturedAtLocal,
    coarseLocationKey: asset.coarsePlace,
    sha256: asset.sha256,
    perceptualGroup: null,
    width: asset.width,
    height: asset.height,
    sharpness: null,
    exposureQuality: null,
    visualQuality: null,
    isScreenshot: false,
  }));

  const clusters = clusterTemporalSequences(domainAssets, {
    // Photos selected in one upload are a useful provisional batch when EXIF
    // time is missing. This avoids ten photos becoming ten model pipelines,
    // while still leaving the event time explicitly unknown.
    groupMissingTimeInSameBatch: true,
  });
  const persistedSequences: IngestionResult["sequences"] = [];
  let deterministicFailures = 0;
  for (const cluster of clusters) {
    const clusterAssets = cluster.assetIds
      .map((id) => unlinked.find((asset) => asset.id === id))
      .filter((asset): asset is StoredAsset => asset !== undefined);
    try {
      persistedSequences.push(
        await persistDeterministicSequence({
          client,
          userId,
          clusterAssets,
          domainAssets: cluster.assets,
          startedAt: cluster.startedAt,
          endedAt: cluster.endedAt,
          coarsePlace: cluster.coarseLocationKey,
          selectedPlace: input.selectedPlace ?? null,
          useMemoryMap: preferences.useMemoryMap,
          shouldAnalyze: preferences.usePhotos,
        }),
      );
    } catch (error) {
      console.error(
        "[ingestUpload] persistDeterministicSequence failed:",
        error,
      );
      deterministicFailures += 1;
    }
  }

  // Re-uploading bytes whose prior AI pass failed is an explicit reprocess
  // request. Reuse the existing deterministic graph instead of duplicating it.
  const retrySequences = await loadRetrySequences({
    client,
    userId,
    assets: uniqueStored.filter((asset) => {
      if (!preferences.usePhotos || !linkedIds.has(asset.id)) return false;
      if (
        asset.analysisStatus === "pending" ||
        asset.analysisStatus === "failed"
      )
        return true;
      return (
        asset.analysisStatus === "processing" &&
        asset.updatedAt !== null &&
        Date.now() - Date.parse(asset.updatedAt) > 2 * 60_000
      );
    }),
    sequenceByAssetId,
  });
  persistedSequences.push(...retrySequences);
  const retryAssetIds = new Set(
    retrySequences.flatMap(({ analysisCandidates }) =>
      analysisCandidates.map(({ id }) => id),
    ),
  );

  const accepted = stored.map((asset) => ({
    id: asset.id,
    ...(asset.uploadSlotId === null ? {} : { slotId: asset.uploadSlotId }),
    name: asset.name,
    capturedAt: asset.capturedAt,
    state: retryAssetIds.has(asset.id)
      ? ("processing" as const)
      : asset.isDuplicate
        ? ("ready" as const)
        : deterministicFailures > 0
          ? ("partial" as const)
          : preferences.usePhotos
            ? ("processing" as const)
            : ("ready" as const),
  }));
  const hasAccepted = accepted.length > 0;
  const processingState = !hasAccepted
    ? ("failed" as const)
    : deterministicFailures > 0 || rejected.length > 0
      ? ("partial" as const)
      : preferences.usePhotos && persistedSequences.length > 0
        ? ("processing" as const)
        : ("ready" as const);
  return {
    accepted,
    rejected,
    sequenceIds: persistedSequences.map(({ sequenceId }) => sequenceId),
    processingState,
    message:
      processingState === "processing"
        ? "写真と確定的なメタデータを保存しました。AI再構成を続けています。"
        : processingState === "partial"
          ? "安全に保存できた写真とEvidenceは残し、失敗した処理だけを停止しました。"
          : processingState === "failed"
            ? "安全に受け付けられる写真がありませんでした。"
            : "写真と確定的なEvidenceを保存しました。",
    sequences: persistedSequences,
    retainedOriginalStorageKeys: uniqueStored
      .filter(({ isDuplicate }) => !isDuplicate)
      .map(({ originalStorageKey }) => originalStorageKey),
  };
}

class UploadValidationError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = "UploadValidationError";
  }
}

async function validateAndStoreAsset(input: {
  client: Client;
  userId: string;
  file: File;
  stagedOriginalKey: string | null;
  reservedAssetId: string | null;
  uploadSlotId: string | null;
  config: RuntimeConfig;
  preferences: {
    usePhotos: boolean;
    useCapturedAt: boolean;
    useLocation: boolean;
  };
  timezoneOffsetMinutes: number | null;
  coarsePlace: string | null;
  resolveCoarseLocation?: (location: CoarseLocation) => Promise<string | null>;
}): Promise<StoredAsset> {
  if (input.file.size > input.config.upload.maxBytesPerFile) {
    throw new UploadValidationError("ファイルサイズが上限を超えています。");
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const validation = validateImageBytes({
    bytes,
    declaredMimeType: input.file.type,
    limits: {
      maxBytes: input.config.upload.maxBytesPerFile,
      maxWidth: 20_000,
      maxHeight: 20_000,
      maxPixels: input.config.upload.maxPixels,
    },
  });
  if (!validation.ok) {
    throw new UploadValidationError(
      validation.issues.some(({ code }) => code === "mime_mismatch")
        ? "拡張子と画像の内容が一致しません。"
        : validation.issues.some(({ code }) => code === "dimensions_too_large")
          ? "画像の縦横サイズが上限を超えています。"
          : "JPEG、PNG、WebPの有効な画像を選んでください。",
    );
  }

  const decoded = await sharp(bytes, {
    limitInputPixels: input.config.upload.maxPixels,
  }).metadata();
  if (
    decoded.width === undefined ||
    decoded.height === undefined ||
    (decoded.pages !== undefined && decoded.pages > 1) ||
    decoded.width * decoded.height > input.config.upload.maxPixels
  ) {
    throw new UploadValidationError("画像を安全に復号できませんでした。");
  }
  const sha256 = await sha256Hex(bytes);
  // Build a metadata-free derivative even for duplicates. It gives an explicit
  // retry request fresh, validated vision input without exposing the original.
  const derivative = await sharp(bytes, {
    limitInputPixels: input.config.upload.maxPixels,
  })
    .rotate()
    .resize({
      width: input.config.upload.visionMaxEdge,
      height: input.config.upload.visionMaxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const derivativeMetadata = await sharp(derivative).metadata();
  if (
    derivativeMetadata.width === undefined ||
    derivativeMetadata.height === undefined
  ) {
    throw new UploadValidationError(
      "AI解析用画像を安全に作成できませんでした。",
    );
  }
  const duplicate = await input.client
    .from("media_assets")
    .select(
      "id,mime_type,captured_at,timezone_offset,coarse_place,sha256,width,height,storage_key,derivative_storage_key,analysis_status,updated_at",
    )
    .eq("user_id", input.userId)
    .eq("sha256", sha256)
    .maybeSingle();
  if (duplicate.error !== null) throw new RepositoryError("duplicate_lookup");
  if (duplicate.data !== null) {
    return {
      id: duplicate.data.id,
      name: input.file.name,
      mimeType: validation.mimeType,
      capturedAt: duplicate.data.captured_at,
      capturedAtLocal: duplicate.data.captured_at?.slice(0, 23) ?? null,
      timezoneOffset: duplicate.data.timezone_offset,
      coarsePlace: duplicate.data.coarse_place,
      sha256,
      width: duplicate.data.width ?? decoded.width,
      height: duplicate.data.height ?? decoded.height,
      derivative,
      derivativeWidth: derivativeMetadata.width,
      derivativeHeight: derivativeMetadata.height,
      originalStorageKey: duplicate.data.storage_key,
      derivativeStorageKey: duplicate.data.derivative_storage_key,
      analysisStatus: duplicate.data.analysis_status,
      updatedAt: duplicate.data.updated_at,
      isDuplicate: true,
      uploadSlotId: input.uploadSlotId,
    };
  }

  const exif =
    validation.mimeType === "image/jpeg"
      ? extractNormalizedExif(bytes)
      : {
          capturedAt: null,
          capturedAtLocal: null,
          timezoneOffset: null,
          coarseLocation: null,
        };
  const resolvedCapturedAt =
    exif.capturedAt ??
    (exif.capturedAtLocal !== null && input.timezoneOffsetMinutes !== null
      ? `${exif.capturedAtLocal}${offsetText(input.timezoneOffsetMinutes)}`
      : null);
  const assetId = input.reservedAssetId ?? crypto.randomUUID();
  const originalKey = `${input.userId}/assets/${assetId}/original`;
  const derivativeKey = `${input.userId}/assets/${assetId}/vision.webp`;
  const bucket = input.client.storage.from("rememory-private");
  if (input.stagedOriginalKey === null) {
    const originalUpload = await bucket.upload(originalKey, bytes, {
      contentType: validation.mimeType,
      upsert: false,
      cacheControl: "0",
    });
    if (originalUpload.error !== null)
      throw new RepositoryError("store_original");
  } else if (input.stagedOriginalKey !== originalKey) {
    throw new RepositoryError("invalid_staged_original_path");
  }
  const derivativeUpload = await bucket.upload(derivativeKey, derivative, {
    contentType: "image/webp",
    upsert: input.stagedOriginalKey !== null,
    cacheControl: "0",
  });
  if (derivativeUpload.error !== null) {
    // A staged original can be shared by a concurrent completion retry. Do
    // not delete it on an uncertain derivative failure; a later retry can
    // safely recreate the derivative at the reserved path.
    if (input.stagedOriginalKey === null) {
      await bucket.remove([originalKey]);
    }
    throw new RepositoryError("store_derivative");
  }

  const capturedAt = input.preferences.useCapturedAt
    ? resolvedCapturedAt
    : null;
  const resolvedCoarseLabel =
    input.coarsePlace === null &&
    input.preferences.useLocation &&
    exif.coarseLocation !== null &&
    input.resolveCoarseLocation !== undefined
      ? await input.resolveCoarseLocation(exif.coarseLocation)
      : null;
  const coarsePlace =
    input.coarsePlace ??
    resolvedCoarseLabel ??
    (input.preferences.useLocation && exif.coarseLocation !== null
      ? exif.coarseLocation.key
      : null);
  const insert = await input.client.from("media_assets").insert({
    id: assetId,
    user_id: input.userId,
    media_type: "image",
    mime_type: validation.mimeType,
    storage_key: originalKey,
    derivative_storage_key: derivativeKey,
    sha256,
    bytes: validation.bytes,
    width: decoded.width,
    height: decoded.height,
    captured_at: capturedAt,
    timezone_offset: input.preferences.useCapturedAt
      ? (exif.timezoneOffset ??
        (input.timezoneOffsetMinutes === null
          ? null
          : offsetText(input.timezoneOffsetMinutes)))
      : null,
    coarse_place: coarsePlace,
    extraction_status: "complete",
    analysis_status: input.preferences.usePhotos ? "pending" : "not_supported",
  });
  if (insert.error !== null) {
    const raced = await input.client
      .from("media_assets")
      .select(
        "id,mime_type,captured_at,timezone_offset,coarse_place,sha256,width,height,storage_key,derivative_storage_key,analysis_status,updated_at",
      )
      .eq("user_id", input.userId)
      .eq("sha256", sha256)
      .maybeSingle();
    if (raced.error !== null || raced.data === null) {
      // For the legacy multipart path these objects belong only to this
      // invocation. Staged objects may concurrently be used by another
      // completion request, so leave them retryable instead of risking a
      // dangling database row.
      if (input.stagedOriginalKey === null) {
        await bucket.remove([originalKey, derivativeKey]);
      }
      throw new RepositoryError("persist_asset");
    }
    if (raced.data.id !== assetId) {
      await bucket.remove([originalKey, derivativeKey]);
    }
    return {
      id: raced.data.id,
      name: input.file.name,
      mimeType: validation.mimeType,
      capturedAt: raced.data.captured_at,
      capturedAtLocal: raced.data.captured_at?.slice(0, 23) ?? null,
      timezoneOffset: raced.data.timezone_offset,
      coarsePlace: raced.data.coarse_place,
      sha256,
      width: raced.data.width ?? decoded.width,
      height: raced.data.height ?? decoded.height,
      derivative,
      derivativeWidth: derivativeMetadata.width,
      derivativeHeight: derivativeMetadata.height,
      originalStorageKey: raced.data.storage_key,
      derivativeStorageKey: raced.data.derivative_storage_key,
      analysisStatus: raced.data.analysis_status,
      updatedAt: raced.data.updated_at,
      isDuplicate: true,
      uploadSlotId: input.uploadSlotId,
    };
  }

  return {
    id: assetId,
    name: input.file.name,
    mimeType: validation.mimeType,
    capturedAt,
    capturedAtLocal: input.preferences.useCapturedAt
      ? exif.capturedAtLocal
      : null,
    timezoneOffset: input.preferences.useCapturedAt
      ? (exif.timezoneOffset ??
        (input.timezoneOffsetMinutes === null
          ? null
          : offsetText(input.timezoneOffsetMinutes)))
      : null,
    coarsePlace,
    sha256,
    width: decoded.width,
    height: decoded.height,
    derivative,
    derivativeWidth: derivativeMetadata.width,
    derivativeHeight: derivativeMetadata.height,
    originalStorageKey: originalKey,
    derivativeStorageKey: derivativeKey,
    analysisStatus: input.preferences.usePhotos ? "pending" : "not_supported",
    updatedAt: null,
    isDuplicate: false,
    uploadSlotId: input.uploadSlotId,
  };
}

function offsetText(offsetMinutes: number): string {
  // `timezoneOffsetMinutes` is local − UTC (e.g. +540 for Asia/Tokyo), which is
  // exactly the ISO 8601 offset sign convention. Negating it here would flip
  // the offset and shift captured times by up to a day.
  const isoMinutes = offsetMinutes;
  const sign = isoMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(isoMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

async function persistDeterministicSequence(input: {
  client: Client;
  userId: string;
  clusterAssets: StoredAsset[];
  domainAssets: SequenceAsset[];
  startedAt: string | null;
  endedAt: string | null;
  coarsePlace: string | null;
  selectedPlace: SelectedPlace | null;
  useMemoryMap: boolean;
  shouldAnalyze: boolean;
}): Promise<IngestionResult["sequences"][number]> {
  const { client, userId } = input;
  const sequenceId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const memoryId = crypto.randomUUID();
  const representatives = selectRepresentativeAssets(input.domainAssets, {
    maxRepresentatives: 4,
  });
  const representativeIds = new Set(
    representatives.map(({ assetId }) => assetId),
  );
  const durationMinutes =
    input.startedAt !== null && input.endedAt !== null
      ? Math.max(
          0,
          (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 60_000,
        )
      : 0;
  const importance = assessMemoryImportance({
    photoCount: input.clusterAssets.length,
    sequenceDurationMinutes: durationMinutes,
    unusualLocation: false,
    temporalDensity: Math.min(1, input.clusterAssets.length / 10),
    visualChange: 0,
    relatedConfirmedMemories: 0,
    repeatedUserInteractions: 0,
    aiContextSignal: null,
  });
  const title = deterministicTitle(
    input.clusterAssets[0]?.capturedAtLocal ?? input.startedAt,
  );

  const sequenceInsert = await client.from("media_sequences").insert({
    id: sequenceId,
    user_id: userId,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    coarse_place: input.coarsePlace,
    status: "active",
    cluster_version: "deterministic-v1-6h-local-date-place",
  });
  if (sequenceInsert.error !== null)
    throw new RepositoryError("create_sequence");
  try {
    const joins = await client.from("sequence_assets").insert(
      input.clusterAssets.map((asset, position) => ({
        user_id: userId,
        sequence_id: sequenceId,
        asset_id: asset.id,
        position,
        is_representative: representativeIds.has(asset.id),
        reason:
          representatives.find(({ assetId }) => assetId === asset.id)?.reason ??
          "sequence_member",
      })),
    );
    if (joins.error !== null) throw new RepositoryError("link_sequence_assets");
    const eventInsert = await client.from("events").insert({
      id: eventId,
      user_id: userId,
      sequence_id: sequenceId,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      coarse_place: input.coarsePlace,
      title_candidate: title,
      status: "active",
    });
    if (eventInsert.error !== null) throw new RepositoryError("create_event");

    const photoEvidenceId = crypto.randomUUID();
    const evidenceRows: Array<Record<string, unknown>> = [
      {
        id: photoEvidenceId,
        user_id: userId,
        event_id: eventId,
        asset_id: input.clusterAssets[0]?.id ?? null,
        kind: "deterministic_observation",
        field: "media_count",
        value_json: { count: input.clusterAssets.length },
        source_type: "system",
        source_version: "ingestion-v1",
        observed_at: input.startedAt,
        validity: "valid",
      },
    ];
    const timeEvidenceId =
      input.startedAt === null ? null : crypto.randomUUID();
    if (timeEvidenceId !== null) {
      evidenceRows.push({
        id: timeEvidenceId,
        user_id: userId,
        event_id: eventId,
        asset_id: input.clusterAssets[0]?.id ?? null,
        kind: "metadata_observation",
        field: "captured_at",
        value_json: { value: input.startedAt },
        source_type: "metadata",
        source_version: "exif-v1",
        observed_at: input.startedAt,
        validity: "valid",
      });
    }
    // Temporal extent and time-of-day are cheap deterministic metadata that let
    // the claim/gap stage make a more accurate guess than photos alone.
    if (durationMinutes > 0) {
      evidenceRows.push({
        id: crypto.randomUUID(),
        user_id: userId,
        event_id: eventId,
        asset_id: input.clusterAssets[0]?.id ?? null,
        kind: "metadata_observation",
        field: "sequence_duration_minutes",
        value_json: { minutes: durationMinutes },
        source_type: "metadata",
        source_version: "exif-v1",
        observed_at: input.startedAt,
        validity: "valid",
      });
    }
    const timeOfDay = timeOfDayBucket(
      input.clusterAssets[0]?.capturedAtLocal ?? input.startedAt,
    );
    if (timeOfDay !== null) {
      evidenceRows.push({
        id: crypto.randomUUID(),
        user_id: userId,
        event_id: eventId,
        asset_id: input.clusterAssets[0]?.id ?? null,
        kind: "metadata_observation",
        field: "time_of_day",
        value_json: { label: timeOfDay },
        source_type: "metadata",
        source_version: "exif-v1",
        observed_at: input.startedAt,
        validity: "valid",
      });
    }
    const coarsePlace = input.selectedPlace?.displayName ?? input.coarsePlace;
    let placeEvidenceId: string | null = null;
    if (coarsePlace !== null) {
      placeEvidenceId = crypto.randomUUID();
      evidenceRows.push({
        id: placeEvidenceId,
        user_id: userId,
        event_id: eventId,
        asset_id: null,
        kind: "coarse_location_observation",
        field: "coarse_place",
        value_json: coarsePlace.startsWith("grid:")
          ? { grid: coarsePlace }
          : { label: coarsePlace },
        source_type: coarsePlace.startsWith("grid:")
          ? "location"
          : "user_statement",
        source_version:
          input.selectedPlace !== null
            ? "place-provider-v1"
            : coarsePlace.startsWith("grid:")
              ? "grid-v1"
              : "upload-label-v1",
        observed_at: input.startedAt,
        validity: "valid",
      });
    }
    const evidenceInsert = await client.from("evidence").insert(evidenceRows);
    if (evidenceInsert.error !== null)
      throw new RepositoryError("create_evidence");

    const memoryInsert = await client.from("memories").insert({
      id: memoryId,
      user_id: userId,
      event_id: eventId,
      title,
      summary:
        "写真と撮影情報から作成したMemoryです。内容はまだ確認されていません。",
      status: "active",
      importance_band: importance.band,
      importance_reasons: importance.reasons,
      visibility: "private",
      share_status: "none",
    });
    if (memoryInsert.error !== null) throw new RepositoryError("create_memory");

    if (input.selectedPlace !== null) {
      await persistSelectedPlace(client, {
        userId,
        memoryId,
        place: input.selectedPlace,
        useMemoryMap: input.useMemoryMap,
      });
    }

    const mediaClaimId = await createDeterministicClaim(client, {
      userId,
      memoryId,
      field: "media_count",
      value: { count: input.clusterAssets.length },
      evidenceId: photoEvidenceId,
      dedupeKey: `${sequenceId}:deterministic:media_count`,
    });
    const timeClaimId =
      timeEvidenceId === null
        ? null
        : await createDeterministicClaim(client, {
            userId,
            memoryId,
            field: "time",
            value: { value: input.startedAt },
            evidenceId: timeEvidenceId,
            dedupeKey: `${sequenceId}:deterministic:time`,
          });
    const placeClaimId =
      placeEvidenceId === null || coarsePlace === null
        ? null
        : coarsePlace.startsWith("grid:")
          ? await createDeterministicClaim(client, {
              userId,
              memoryId,
              field: "location",
              value: { grid: coarsePlace },
              evidenceId: placeEvidenceId,
              dedupeKey: `${sequenceId}:deterministic:location`,
            })
          : await createUserConfirmedClaim(client, {
              userId,
              memoryId,
              field: "location",
              value:
                input.selectedPlace === null
                  ? { label: coarsePlace }
                  : {
                      label: input.selectedPlace.displayName,
                      provider: input.selectedPlace.provider,
                      providerPlaceId: input.selectedPlace.providerPlaceId,
                      coarseArea: input.selectedPlace.coarseArea,
                      category: input.selectedPlace.category,
                      source: "user_selected",
                    },
              idempotencyKey: stableUuidFromText(
                `${sequenceId}:user-location:${coarsePlace}`,
              ),
            });
    void mediaClaimId;

    const contextInsert = await client.from("memory_context_dimensions").insert(
      [
        ["time", timeClaimId === null ? "missing" : "known", timeClaimId, 3],
        [
          "location",
          placeClaimId === null ? "unknown" : "known",
          placeClaimId,
          2,
        ],
        ["activity", "missing", null, 3],
        ["purpose", "missing", null, 3],
        ["people", "unknown", null, 1],
        ["result", "unknown", null, 1],
        ["meaning", "not_applicable", null, 1],
      ].map(([dimension, status, activeClaimId, importanceWeight]) => ({
        user_id: userId,
        memory_id: memoryId,
        dimension,
        status,
        active_claim_id: activeClaimId,
        importance_weight: importanceWeight,
      })),
    );
    if (contextInsert.error !== null)
      throw new RepositoryError("create_context_dimensions");
  } catch (error) {
    await client
      .from("events")
      .delete()
      .eq("id", eventId)
      .eq("user_id", userId);
    await client
      .from("media_sequences")
      .delete()
      .eq("id", sequenceId)
      .eq("user_id", userId);
    throw error;
  }

  return {
    sequenceId,
    memoryId,
    analysisCandidates: input.shouldAnalyze
      ? input.clusterAssets.filter(({ id }) => representativeIds.has(id))
      : [],
  };
}

async function persistSelectedPlace(
  client: Client,
  input: {
    userId: string;
    memoryId: string;
    place: SelectedPlace;
    useMemoryMap: boolean;
  },
) {
  const canonical = await client
    .from("canonical_places")
    .upsert(
      {
        provider: input.place.provider,
        provider_place_id: input.place.providerPlaceId,
        place_label: input.place.displayName,
        coarse_area: input.place.coarseArea,
        map_cell_id: input.place.mapCellId,
        place_category: input.place.category,
      },
      { onConflict: "provider,provider_place_id" },
    )
    .select("id")
    .single();
  if (canonical.error !== null || typeof canonical.data?.id !== "string") {
    throw new RepositoryError("persist_canonical_place");
  }
  const linked = await client.from("memory_places").upsert(
    {
      user_id: input.userId,
      memory_id: input.memoryId,
      place_id: canonical.data.id,
      source: "user_selected",
    },
    { onConflict: "memory_id" },
  );
  if (linked.error !== null) throw new RepositoryError("link_memory_place");

  if (!input.useMemoryMap) return;
  const cell = await client.rpc("reveal_memory_map_cell", {
    p_user_id: input.userId,
    p_cell_id: input.place.mapCellId,
  });
  if (cell.error !== null) throw new RepositoryError("persist_place_map_cell");
  const cellLabel = await client
    .from("memory_map_cells")
    .update({ coarse_place: input.place.displayName })
    .eq("user_id", input.userId)
    .eq("cell_id", input.place.mapCellId);
  if (cellLabel.error !== null)
    throw new RepositoryError("label_place_map_cell");
  const mapLink = await client.from("memory_map_cell_memories").upsert(
    {
      user_id: input.userId,
      cell_id: input.place.mapCellId,
      memory_id: input.memoryId,
    },
    { onConflict: "user_id,cell_id,memory_id" },
  );
  if (mapLink.error !== null)
    throw new RepositoryError("link_place_map_memory");
}

async function loadRetrySequences(input: {
  client: Client;
  userId: string;
  assets: StoredAsset[];
  sequenceByAssetId: Map<string, string>;
}): Promise<IngestionResult["sequences"]> {
  const grouped = new Map<string, StoredAsset[]>();
  for (const asset of input.assets) {
    const sequenceId = input.sequenceByAssetId.get(asset.id);
    if (sequenceId === undefined) continue;
    const current = grouped.get(sequenceId) ?? [];
    current.push(asset);
    grouped.set(sequenceId, current);
  }

  const result: IngestionResult["sequences"] = [];
  for (const [sequenceId] of grouped) {
    const event = await input.client
      .from("events")
      .select("id")
      .eq("user_id", input.userId)
      .eq("sequence_id", sequenceId)
      .eq("status", "active")
      .maybeSingle();
    if (event.error !== null) throw new RepositoryError("load_retry_event");
    if (event.data === null) continue;
    const memory = await input.client
      .from("memories")
      .select("id")
      .eq("user_id", input.userId)
      .eq("event_id", event.data.id)
      .eq("status", "active")
      .maybeSingle();
    if (memory.error !== null) throw new RepositoryError("load_retry_memory");
    if (memory.data === null) continue;

    const representativeLinks = await input.client
      .from("sequence_assets")
      .select("asset_id")
      .eq("user_id", input.userId)
      .eq("sequence_id", sequenceId)
      .eq("is_representative", true)
      .order("position", { ascending: true })
      .limit(4);
    if (representativeLinks.error !== null) {
      throw new RepositoryError("load_retry_representatives");
    }
    const representativeIds = (representativeLinks.data ?? []).map(
      ({ asset_id }) => asset_id,
    );
    const representativeRows =
      representativeIds.length === 0
        ? { data: [], error: null }
        : await input.client
            .from("media_assets")
            .select(
              "id,mime_type,captured_at,timezone_offset,coarse_place,sha256,width,height,storage_key,derivative_storage_key,analysis_status,updated_at",
            )
            .eq("user_id", input.userId)
            .in("id", representativeIds);
    if (representativeRows.error !== null) {
      throw new RepositoryError("load_retry_representative_assets");
    }

    const uploadedById = new Map(
      input.assets.map((asset) => [asset.id, asset]),
    );
    const analysisCandidates: StoredAsset[] = [];
    for (const row of representativeRows.data ?? []) {
      const uploaded = uploadedById.get(row.id);
      if (uploaded !== undefined) {
        analysisCandidates.push(uploaded);
        continue;
      }
      if (typeof row.derivative_storage_key !== "string") continue;
      const downloaded = await input.client.storage
        .from("rememory-private")
        .download(row.derivative_storage_key);
      if (downloaded.error !== null) {
        throw new RepositoryError("download_retry_derivative");
      }
      const derivative = Buffer.from(await downloaded.data.arrayBuffer());
      const metadata = await sharp(derivative).metadata();
      if (metadata.width === undefined || metadata.height === undefined) {
        throw new RepositoryError("decode_retry_derivative");
      }
      analysisCandidates.push({
        id: row.id,
        name: "stored-private-derivative",
        mimeType: row.mime_type as SupportedImageMime,
        capturedAt: row.captured_at,
        capturedAtLocal: row.captured_at?.slice(0, 23) ?? null,
        timezoneOffset: row.timezone_offset,
        coarsePlace: row.coarse_place,
        sha256: row.sha256,
        width: row.width ?? metadata.width,
        height: row.height ?? metadata.height,
        derivative,
        derivativeWidth: metadata.width,
        derivativeHeight: metadata.height,
        originalStorageKey: row.storage_key,
        derivativeStorageKey: row.derivative_storage_key,
        analysisStatus: row.analysis_status,
        updatedAt: row.updated_at,
        isDuplicate: true,
        uploadSlotId: null,
      });
    }
    if (analysisCandidates.length > 0) {
      result.push({
        sequenceId,
        memoryId: memory.data.id,
        analysisCandidates,
      });
    }
  }
  return result;
}

function deterministicTitle(capturedAt: string | null | undefined): string {
  const date = capturedAt?.slice(0, 10);
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  return match === null || match === undefined
    ? "日時未確認の記憶"
    : `${match[1]}年${Number(match[2])}月${Number(match[3])}日の記憶`;
}

/** Coarse local-time bucket so a claim can say "an evening", not just a date. */
function timeOfDayBucket(
  capturedAt: string | null | undefined,
): "morning" | "daytime" | "evening" | "night" | null {
  if (capturedAt === null || capturedAt === undefined) return null;
  const parsed = Date.parse(capturedAt);
  if (!Number.isFinite(parsed)) return null;
  const hour = new Date(parsed).getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "daytime";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

async function createDeterministicClaim(
  client: Client,
  input: {
    userId: string;
    memoryId: string;
    field: string;
    value: unknown;
    evidenceId: string;
    dedupeKey: string;
  },
): Promise<string> {
  const { data, error } = await client.rpc("create_evidence_backed_claim", {
    p_memory_id: input.memoryId,
    p_user_id: input.userId,
    p_field: input.field,
    p_value_json: input.value,
    p_origin: "deterministic",
    p_confidence_band: "high",
    p_evidence_ids: [input.evidenceId],
    p_ai_run_id: null,
    p_dedupe_key: input.dedupeKey,
  });
  if (error !== null || typeof data !== "string") {
    throw new RepositoryError("create_deterministic_claim");
  }
  return data;
}

async function createUserConfirmedClaim(
  client: Client,
  input: {
    userId: string;
    memoryId: string;
    field: string;
    value: unknown;
    idempotencyKey: string;
  },
): Promise<string> {
  const { data, error } = await client.rpc("apply_user_correction", {
    p_user_id: input.userId,
    p_memory_id: input.memoryId,
    p_target_claim_id: null,
    p_action: "replace",
    p_value_json: input.value,
    p_field: input.field,
    p_idempotency_key: input.idempotencyKey,
  });
  const result = Array.isArray(data) ? data[0] : data;
  if (
    error !== null ||
    result === null ||
    typeof result !== "object" ||
    typeof (result as Record<string, unknown>).created_claim_id !== "string"
  ) {
    throw new RepositoryError("create_user_location_claim");
  }
  return (result as Record<string, unknown>).created_claim_id as string;
}

function stableUuidFromText(value: string): string {
  // UUID v5-shaped deterministic key; collision resistance comes from the
  // per-sequence UUID prefix and this is used only as an idempotency token.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  const seed = `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
  const hex = `${seed}${seed}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
