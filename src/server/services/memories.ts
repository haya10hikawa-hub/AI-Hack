import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const EventSchema = z.object({
  id: z.string().uuid(),
  sequence_id: z.string().uuid().nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  coarse_place: z.string().nullable(),
});

const MemorySchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  title: z.string(),
  summary: z.string().nullable(),
  status: z.enum(["draft", "active", "disputed", "deleting", "deleted"]),
  importance_band: z.enum(["low", "medium", "high"]),
  created_at: z.string(),
  updated_at: z.string(),
  event: z.union([EventSchema, z.array(EventSchema)]).nullable(),
});

const ClaimSchema = z.object({
  id: z.string().uuid(),
  memory_id: z.string().uuid(),
  field: z.string(),
  value_json: z.unknown(),
  origin: z.enum(["deterministic", "ai", "user"]),
  confirmation_status: z.enum(["unconfirmed", "user_confirmed", "disputed"]),
  status: z.string(),
  claim_evidence: z
    .array(z.object({ evidence_id: z.string().uuid() }))
    .optional()
    .default([]),
});

const EvidenceSchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid().nullable(),
  asset_id: z.string().uuid().nullable(),
  kind: z.string(),
  field: z.string(),
  value_json: z.unknown(),
  source_type: z.string(),
  observed_at: z.string().nullable(),
  validity: z.string(),
});

type Client = SupabaseClient;

export class RepositoryError extends Error {
  constructor(public readonly operation: string) {
    super(`Repository operation failed: ${operation}`);
    this.name = "RepositoryError";
  }
}

function oneEvent(value: z.infer<typeof MemorySchema>["event"]) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "label",
      "value",
      "text",
      "name",
      "activity",
      "purpose",
    ]) {
      if (typeof record[key] === "string") return record[key].slice(0, 500);
    }
  }
  return "構造化された根拠";
}

async function signedDerivativeUrls(client: Client, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const { data, error } = await client.storage
    .from("rememory-private")
    .createSignedUrls(unique, 60);
  if (error !== null) return new Map<string, string>();
  return new Map(
    (data ?? [])
      .filter((item) => item.signedUrl !== null)
      .map((item) => [item.path ?? "", item.signedUrl] as const),
  );
}

export async function getMemoryThread(client: Client, userId: string) {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("memories")
    .select(
      "id,event_id,title,summary,status,importance_band,created_at,updated_at,event:events(id,sequence_id,started_at,ended_at,coarse_place)",
    )
    .eq("user_id", userId)
    .in("status", ["draft", "active", "disputed"])
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error !== null) throw new RepositoryError("list_memories");

  const memories = (data ?? [])
    .map((row) => MemorySchema.safeParse(row))
    .filter((result) => result.success)
    .map((result) => result.data);
  const memoryIds = memories.map(({ id }) => id);
  const sequenceIds = memories
    .map((memory) => oneEvent(memory.event)?.sequence_id ?? null)
    .filter((id): id is string => id !== null);
  const eventIds = memories
    .map((memory) => oneEvent(memory.event)?.id ?? null)
    .filter((id): id is string => id !== null);

  const [claimResult, gapResult, sequenceAssetResult, evidenceResult] =
    await Promise.all([
      memoryIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("claims")
            .select(
              "id,memory_id,field,value_json,origin,confirmation_status,status",
            )
            .eq("user_id", userId)
            .in("memory_id", memoryIds)
            .eq("status", "active"),
      memoryIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("memory_gaps")
            .select("id,memory_id,status")
            .eq("user_id", userId)
            .in("memory_id", memoryIds)
            .or(
              `status.eq.ready_to_ask,and(status.eq.deferred,deferred_until.lte.${now})`,
            ),
      sequenceIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("sequence_assets")
            .select(
              "sequence_id,is_representative,asset:media_assets(id,derivative_storage_key,analysis_status)",
            )
            .in("sequence_id", sequenceIds),
      eventIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("evidence")
            .select("id,event_id")
            .eq("user_id", userId)
            .in("event_id", eventIds)
            .eq("validity", "valid"),
    ]);
  if (
    claimResult.error !== null ||
    gapResult.error !== null ||
    sequenceAssetResult.error !== null ||
    evidenceResult.error !== null
  ) {
    throw new RepositoryError("assemble_memory_thread");
  }

  const claims = (claimResult.data ?? [])
    .map((row) => ClaimSchema.safeParse({ ...row, claim_evidence: [] }))
    .filter((result) => result.success)
    .map((result) => result.data);
  const claimsByMemory = new Map<string, typeof claims>();
  claims.forEach((claim) => {
    claimsByMemory.set(claim.memory_id, [
      ...(claimsByMemory.get(claim.memory_id) ?? []),
      claim,
    ]);
  });

  const gapMemoryIds = new Set(
    (gapResult.data ?? [])
      .map((row) => (typeof row.memory_id === "string" ? row.memory_id : null))
      .filter((id): id is string => id !== null),
  );
  const assetRows = (sequenceAssetResult.data ?? []) as unknown[];
  const photoCount = new Map<string, number>();
  const representativePath = new Map<string, string>();
  const processingSequences = new Set<string>();
  const failedSequences = new Set<string>();
  assetRows.forEach((row) => {
    if (row === null || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    if (typeof record.sequence_id !== "string") return;
    const sequenceId = record.sequence_id;
    photoCount.set(sequenceId, (photoCount.get(sequenceId) ?? 0) + 1);
    const assetValue = Array.isArray(record.asset)
      ? record.asset[0]
      : record.asset;
    if (assetValue === null || typeof assetValue !== "object") return;
    const asset = assetValue as Record<string, unknown>;
    if (
      asset.analysis_status === "pending" ||
      asset.analysis_status === "processing"
    ) {
      processingSequences.add(sequenceId);
    }
    if (asset.analysis_status === "failed") {
      failedSequences.add(sequenceId);
    }
    if (
      record.is_representative === true &&
      typeof asset.derivative_storage_key === "string"
    ) {
      representativePath.set(sequenceId, asset.derivative_storage_key);
    }
  });
  const urls = await signedDerivativeUrls(client, [
    ...representativePath.values(),
  ]);

  const evidenceCount = new Map<string, number>();
  (evidenceResult.data ?? []).forEach((row) => {
    if (typeof row.event_id === "string") {
      evidenceCount.set(
        row.event_id,
        (evidenceCount.get(row.event_id) ?? 0) + 1,
      );
    }
  });

  const items = memories.map((memory) => {
    const event = oneEvent(memory.event);
    const memoryClaims = claimsByMemory.get(memory.id) ?? [];
    const hasConfirmed = memoryClaims.some(
      (claim) =>
        claim.origin === "user" &&
        claim.confirmation_status === "user_confirmed",
    );
    const hasInference = memoryClaims.some((claim) => claim.origin === "ai");
    const sequenceId = event?.sequence_id ?? null;
    const imagePath = sequenceId
      ? representativePath.get(sequenceId)
      : undefined;
    return {
      id: memory.id,
      title: memory.title,
      capturedAt: event?.started_at ?? null,
      placeLabel: event?.coarse_place ?? null,
      photoCount: sequenceId ? (photoCount.get(sequenceId) ?? 0) : 0,
      representativeImageUrl: imagePath ? (urls.get(imagePath) ?? null) : null,
      representativeImageAlt: `${memory.title}の代表写真`,
      state:
        memory.status === "disputed"
          ? ("disputed" as const)
          : hasConfirmed
            ? ("confirmed" as const)
            : hasInference
              ? ("inferred" as const)
              : ("evidence" as const),
      processingState:
        memory.status === "draft" ||
        (sequenceId !== null && processingSequences.has(sequenceId))
          ? ("processing" as const)
          : sequenceId !== null && failedSequences.has(sequenceId)
            ? ("failed" as const)
            : ("ready" as const),
      summary: memory.summary,
      relationLabel: null,
      relationState: null,
      hasOpenGap: gapMemoryIds.has(memory.id),
      evidenceCount: event ? (evidenceCount.get(event.id) ?? 0) : 0,
    };
  });

  return {
    memories: items,
    pendingConfirmationCount: gapMemoryIds.size,
    partial: items.some(({ processingState }) => processingState !== "ready"),
    partialMessage: items.some(
      ({ processingState }) => processingState === "failed",
    )
      ? "写真と確定的な情報は保存済みです。失敗したAI再構成は、保存済みの途中結果から再試行できます。"
      : items.some(({ processingState }) => processingState === "processing")
        ? "写真は保存済みです。AIによる再構成を続けています。"
        : null,
  };
}

export async function getMemoryDetail(
  client: Client,
  userId: string,
  memoryId: string,
) {
  const { data, error } = await client
    .from("memories")
    .select(
      "id,event_id,title,summary,status,importance_band,created_at,updated_at,event:events(id,sequence_id,started_at,ended_at,coarse_place)",
    )
    .eq("user_id", userId)
    .eq("id", memoryId)
    .in("status", ["draft", "active", "disputed"])
    .maybeSingle();
  if (error !== null) throw new RepositoryError("get_memory");
  if (data === null) return null;
  const memory = MemorySchema.parse(data);
  const event = oneEvent(memory.event);

  const [claimResult, evidenceResult] = await Promise.all([
    client
      .from("claims")
      .select(
        "id,memory_id,field,value_json,origin,confirmation_status,status,claim_evidence(evidence_id)",
      )
      .eq("user_id", userId)
      .eq("memory_id", memoryId)
      .eq("status", "active"),
    event === null
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("evidence")
          .select(
            "id,event_id,asset_id,kind,field,value_json,source_type,observed_at,validity",
          )
          .eq("user_id", userId)
          .eq("event_id", event.id)
          .in("validity", ["valid", "uncertain"]),
  ]);
  if (claimResult.error !== null || evidenceResult.error !== null) {
    throw new RepositoryError("get_memory_provenance");
  }
  const claims = (claimResult.data ?? [])
    .map((row) => ClaimSchema.safeParse(row))
    .filter((result) => result.success)
    .map((result) => result.data);
  const evidence = (evidenceResult.data ?? [])
    .map((row) => EvidenceSchema.safeParse(row))
    .filter((result) => result.success)
    .map((result) => result.data);

  const assetIds = evidence
    .map(({ asset_id }) => asset_id)
    .filter((id): id is string => id !== null);
  const assetResult =
    assetIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("media_assets")
          .select("id,derivative_storage_key,captured_at")
          .eq("user_id", userId)
          .in("id", assetIds);
  if (assetResult.error !== null)
    throw new RepositoryError("get_evidence_assets");
  const assetPath = new Map<
    string,
    { path: string; capturedAt: string | null }
  >();
  (assetResult.data ?? []).forEach((asset) => {
    if (typeof asset.derivative_storage_key === "string") {
      assetPath.set(asset.id, {
        path: asset.derivative_storage_key,
        capturedAt: asset.captured_at,
      });
    }
  });
  const urls = await signedDerivativeUrls(
    client,
    [...assetPath.values()].map(({ path }) => path),
  );

  const thread = await getMemoryThread(client, userId);
  const item = thread.memories.find(({ id }) => id === memoryId);
  if (item === undefined) return null;

  return {
    memory: {
      ...item,
      description: memory.summary,
      updatedAt: memory.updated_at,
    },
    reconstruction: memory.summary,
    claims: claims.map((claim) => ({
      id: claim.id,
      text: `${claim.field}: ${displayValue(claim.value_json)}`,
      state:
        claim.confirmation_status === "disputed"
          ? ("disputed" as const)
          : claim.origin === "user" &&
              claim.confirmation_status === "user_confirmed"
            ? ("confirmed" as const)
            : claim.origin === "ai"
              ? ("inferred" as const)
              : ("evidence" as const),
      origin: claim.origin,
      evidenceIds: claim.claim_evidence.map(({ evidence_id }) => evidence_id),
    })),
    evidence: evidence.map((entry) => {
      const media = entry.asset_id ? assetPath.get(entry.asset_id) : undefined;
      return {
        id: entry.id,
        label: entry.field,
        detail: displayValue(entry.value_json),
        kind:
          entry.source_type === "metadata"
            ? ("metadata" as const)
            : entry.asset_id !== null
              ? ("photo" as const)
              : ("other" as const),
        sourceLabel: entry.source_type,
        imageUrl: media ? (urls.get(media.path) ?? null) : null,
        capturedAt: entry.observed_at ?? media?.capturedAt ?? null,
      };
    }),
    partial:
      item.processingState === "processing" ||
      item.processingState === "failed",
    partialMessage:
      item.processingState === "processing"
        ? "決定的なEvidenceは保存済みですが、AI再構成はまだ完了していません。"
        : item.processingState === "failed"
          ? "決定的なEvidenceは保存済みです。AI再構成は保存済みの途中結果から再試行できます。"
          : null,
  };
}
