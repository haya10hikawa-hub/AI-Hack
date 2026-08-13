import { z } from "zod";

const LocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u)
  .refine((value) => isValidLocalDateTime(value), "Invalid local date-time.");

const AbsoluteDateTimeSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
      /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
      Number.isFinite(Date.parse(value)),
    "Expected an ISO date-time with an offset.",
  );

export const SequenceAssetSchema = z
  .object({
    id: z.string().min(1).max(200),
    capturedAt: AbsoluteDateTimeSchema.nullable().default(null),
    capturedAtLocal: LocalDateTimeSchema.nullable().default(null),
    coarseLocationKey: z.string().min(1).max(100).nullable().default(null),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .default(null),
    perceptualGroup: z.string().min(1).max(200).nullable().default(null),
    width: z.number().int().positive().nullable().default(null),
    height: z.number().int().positive().nullable().default(null),
    sharpness: z.number().min(0).max(1).nullable().default(null),
    exposureQuality: z.number().min(0).max(1).nullable().default(null),
    visualQuality: z.number().min(0).max(1).nullable().default(null),
    isScreenshot: z.boolean().default(false),
  })
  .strict();

export type SequenceAsset = z.infer<typeof SequenceAssetSchema>;

export const SequenceClusteringOptionsSchema = z
  .object({
    maxGapMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1000),
    splitOnLocalDate: z.boolean(),
    splitOnDifferentCoarseLocation: z.boolean(),
    groupMissingTimeInSameBatch: z.boolean(),
  })
  .strict();

export type SequenceClusteringOptions = z.infer<
  typeof SequenceClusteringOptionsSchema
>;

export const DEFAULT_SEQUENCE_CLUSTERING_OPTIONS: Readonly<SequenceClusteringOptions> =
  Object.freeze({
    maxGapMs: 6 * 60 * 60 * 1000,
    splitOnLocalDate: true,
    splitOnDifferentCoarseLocation: true,
    groupMissingTimeInSameBatch: false,
  });

export interface TemporalSequence {
  assetIds: string[];
  assets: SequenceAsset[];
  startedAt: string | null;
  endedAt: string | null;
  coarseLocationKey: string | null;
  boundaryReason:
    | "first"
    | "local_date"
    | "time_gap"
    | "coarse_location"
    | "missing_time";
}

interface SortableAsset {
  asset: SequenceAsset;
  originalIndex: number;
  instantMs: number | null;
  localDate: string | null;
}

/** Deterministic v1 clustering. Unknown times only merge when the caller marks
 * the assets as one explicit ingestion batch; no timestamp is manufactured. */
export function clusterTemporalSequences(
  rawAssets: readonly SequenceAsset[],
  rawOptions: Partial<SequenceClusteringOptions> = {},
): TemporalSequence[] {
  const options = SequenceClusteringOptionsSchema.parse({
    ...DEFAULT_SEQUENCE_CLUSTERING_OPTIONS,
    ...rawOptions,
  });
  const seenIds = new Set<string>();
  const assets = rawAssets.map((rawAsset, originalIndex): SortableAsset => {
    const asset = SequenceAssetSchema.parse(rawAsset);
    if (seenIds.has(asset.id)) {
      throw new Error(`Duplicate sequence asset id: ${asset.id}`);
    }
    seenIds.add(asset.id);

    return {
      asset,
      originalIndex,
      instantMs: assetInstantMs(asset),
      localDate: assetLocalDate(asset),
    };
  });

  assets.sort((left, right) => {
    if (left.instantMs === null && right.instantMs === null) {
      return left.originalIndex - right.originalIndex;
    }
    if (left.instantMs === null) return 1;
    if (right.instantMs === null) return -1;
    return (
      left.instantMs - right.instantMs ||
      left.originalIndex - right.originalIndex
    );
  });

  const sequences: TemporalSequence[] = [];
  let current: SortableAsset[] = [];
  let currentReason: TemporalSequence["boundaryReason"] = "first";

  const finishCurrent = () => {
    if (current.length === 0) return;
    sequences.push(toSequence(current, currentReason));
    current = [];
  };

  for (const candidate of assets) {
    const previous = current.at(-1);
    const boundaryReason = previous
      ? sequenceBoundaryReason(previous, candidate, options)
      : null;

    if (boundaryReason !== null) {
      finishCurrent();
      currentReason = boundaryReason;
    }
    current.push(candidate);
  }
  finishCurrent();

  return sequences;
}

export const RepresentativeSelectionOptionsSchema = z
  .object({
    maxRepresentatives: z.number().int().min(1).max(10),
    minimumQuality: z.number().min(0).max(1),
  })
  .strict();

export type RepresentativeSelectionOptions = z.infer<
  typeof RepresentativeSelectionOptionsSchema
>;

export interface RepresentativeSelection {
  assetId: string;
  score: number;
  reason: "quality" | "temporal_coverage" | "only_available";
}

/** Selects a small, non-duplicate, time-diverse set before vision processing. */
export function selectRepresentativeAssets(
  rawAssets: readonly SequenceAsset[],
  rawOptions: Partial<RepresentativeSelectionOptions> = {},
): RepresentativeSelection[] {
  const options = RepresentativeSelectionOptionsSchema.parse({
    maxRepresentatives: 3,
    minimumQuality: 0.15,
    ...rawOptions,
  });
  if (rawAssets.length === 0) return [];

  const parsed = rawAssets.map((asset) => SequenceAssetSchema.parse(asset));
  const unique = keepBestFromDuplicateGroups(parsed);
  const candidates = unique
    .map((asset, originalIndex) => ({
      asset,
      originalIndex,
      quality: representativeQuality(asset),
      instantMs: assetInstantMs(asset),
    }))
    .filter((candidate) => candidate.quality >= options.minimumQuality)
    .sort(
      (left, right) =>
        right.quality - left.quality ||
        left.originalIndex - right.originalIndex ||
        left.asset.id.localeCompare(right.asset.id),
    );

  const pool =
    candidates.length > 0
      ? candidates
      : unique.map((asset, originalIndex) => ({
          asset,
          originalIndex,
          quality: representativeQuality(asset),
          instantMs: assetInstantMs(asset),
        }));
  if (pool.length === 0) return [];

  const selected = [pool[0]!];
  const remaining = pool.slice(1);

  while (selected.length < options.maxRepresentatives && remaining.length > 0) {
    const ranked = remaining
      .map((candidate) => ({
        candidate,
        diversity: minimumTemporalDistance(candidate, selected, pool.length),
      }))
      .sort(
        (left, right) =>
          right.candidate.quality * 0.7 +
            right.diversity * 0.3 -
            (left.candidate.quality * 0.7 + left.diversity * 0.3) ||
          left.candidate.originalIndex - right.candidate.originalIndex,
      );
    const next = ranked[0]!.candidate;
    selected.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }

  const qualityRepresentativeId = selected[0]!.asset.id;
  return selected
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((candidate) => ({
      assetId: candidate.asset.id,
      score: round(candidate.quality),
      reason:
        pool.length === 1
          ? "only_available"
          : candidate.asset.id === qualityRepresentativeId
            ? "quality"
            : "temporal_coverage",
    }));
}

function sequenceBoundaryReason(
  previous: SortableAsset,
  next: SortableAsset,
  options: SequenceClusteringOptions,
): TemporalSequence["boundaryReason"] | null {
  if (previous.instantMs === null || next.instantMs === null) {
    if (
      options.groupMissingTimeInSameBatch &&
      previous.instantMs === null &&
      next.instantMs === null
    ) {
      if (
        options.splitOnDifferentCoarseLocation &&
        previous.asset.coarseLocationKey !== null &&
        next.asset.coarseLocationKey !== null &&
        coarseLocationsRequireSplit(
          previous.asset.coarseLocationKey,
          next.asset.coarseLocationKey,
        )
      ) {
        return "coarse_location";
      }
      return null;
    }
    return "missing_time";
  }
  if (
    options.splitOnLocalDate &&
    previous.localDate !== null &&
    next.localDate !== null &&
    previous.localDate !== next.localDate
  ) {
    return "local_date";
  }
  if (next.instantMs - previous.instantMs > options.maxGapMs) {
    return "time_gap";
  }
  if (
    options.splitOnDifferentCoarseLocation &&
    previous.asset.coarseLocationKey !== null &&
    next.asset.coarseLocationKey !== null &&
    coarseLocationsRequireSplit(
      previous.asset.coarseLocationKey,
      next.asset.coarseLocationKey,
    )
  ) {
    return "coarse_location";
  }
  return null;
}

function toSequence(
  assets: readonly SortableAsset[],
  boundaryReason: TemporalSequence["boundaryReason"],
): TemporalSequence {
  const absoluteTimes = assets
    .map(({ asset }) => asset.capturedAt)
    .filter((value): value is string => value !== null);
  const locations = new Set(
    assets
      .map(({ asset }) => asset.coarseLocationKey)
      .filter((value): value is string => value !== null),
  );

  return {
    assetIds: assets.map(({ asset }) => asset.id),
    assets: assets.map(({ asset }) => asset),
    startedAt: absoluteTimes[0] ?? null,
    endedAt: absoluteTimes.at(-1) ?? null,
    coarseLocationKey: locations.size === 1 ? [...locations][0]! : null,
    boundaryReason,
  };
}

function assetInstantMs(asset: SequenceAsset): number | null {
  if (asset.capturedAt !== null) return Date.parse(asset.capturedAt);
  if (asset.capturedAtLocal !== null)
    return Date.parse(`${asset.capturedAtLocal}Z`);
  return null;
}

function assetLocalDate(asset: SequenceAsset): string | null {
  return (
    asset.capturedAtLocal?.slice(0, 10) ??
    asset.capturedAt?.slice(0, 10) ??
    null
  );
}

function keepBestFromDuplicateGroups(
  assets: readonly SequenceAsset[],
): SequenceAsset[] {
  type IndexedAsset = { asset: SequenceAsset; index: number };
  const chooseBestBy = (
    entries: readonly IndexedAsset[],
    groupFor: (asset: SequenceAsset) => string | null,
  ): IndexedAsset[] => {
    const grouped = new Map<string, IndexedAsset>();
    const ungrouped: IndexedAsset[] = [];
    for (const entry of entries) {
      const group = groupFor(entry.asset);
      if (group === null) {
        ungrouped.push(entry);
        continue;
      }
      const current = grouped.get(group);
      if (
        current === undefined ||
        representativeQuality(entry.asset) >
          representativeQuality(current.asset)
      ) {
        grouped.set(group, entry);
      }
    }
    return [...ungrouped, ...grouped.values()].sort(
      (left, right) => left.index - right.index,
    );
  };

  const indexed = assets.map((asset, index) => ({ asset, index }));
  // Exact duplicates are always collapsed, even if an upstream perceptual
  // grouper happened to assign different burst labels to identical bytes.
  const exactUnique = chooseBestBy(indexed, ({ sha256 }) => sha256);
  const perceptuallyUnique = chooseBestBy(
    exactUnique,
    ({ perceptualGroup }) => perceptualGroup,
  );
  return perceptuallyUnique.map(({ asset }) => asset);
}

function representativeQuality(asset: SequenceAsset): number {
  const pixels = (asset.width ?? 0) * (asset.height ?? 0);
  const resolution =
    pixels === 0 ? 0.35 : Math.min(1, Math.sqrt(pixels / 12_000_000));
  const visual = asset.visualQuality ?? 0.5;
  const sharpness = asset.sharpness ?? 0.5;
  const exposure = asset.exposureQuality ?? 0.5;
  const screenshotPenalty = asset.isScreenshot ? 0.25 : 0;
  return clamp(
    visual * 0.4 +
      sharpness * 0.25 +
      exposure * 0.2 +
      resolution * 0.15 -
      screenshotPenalty,
  );
}

function minimumTemporalDistance(
  candidate: { originalIndex: number; instantMs: number | null },
  selected: readonly { originalIndex: number; instantMs: number | null }[],
  poolLength: number,
): number {
  const distances = selected.map((item) => {
    if (candidate.instantMs !== null && item.instantMs !== null) {
      return Math.min(
        1,
        Math.abs(candidate.instantMs - item.instantMs) / (6 * 60 * 60 * 1000),
      );
    }
    return Math.min(
      1,
      Math.abs(candidate.originalIndex - item.originalIndex) /
        Math.max(1, poolLength - 1),
    );
  });
  return Math.min(...distances);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function coarseLocationsRequireSplit(left: string, right: string): boolean {
  if (left === right) return false;
  const leftGrid = parseGridKey(left);
  const rightGrid = parseGridKey(right);
  if (
    leftGrid === null ||
    rightGrid === null ||
    leftGrid.gridDegrees !== rightGrid.gridDegrees
  ) {
    return true;
  }

  // Adjacent buckets may be one physical place straddling a grid boundary.
  return (
    Math.abs(leftGrid.latitudeBucket - rightGrid.latitudeBucket) > 1 ||
    Math.abs(leftGrid.longitudeBucket - rightGrid.longitudeBucket) > 1
  );
}

function parseGridKey(value: string): {
  latitudeBucket: number;
  longitudeBucket: number;
  gridDegrees: number;
} | null {
  const match = value.match(/^grid:([0-9a-z]+):([0-9a-z]+):(\d+(?:\.\d+)?)$/u);
  if (match === null) return null;
  const latitudeBucket = Number.parseInt(match[1]!, 36);
  const longitudeBucket = Number.parseInt(match[2]!, 36);
  const gridDegrees = Number(match[3]);
  return Number.isFinite(latitudeBucket) &&
    Number.isFinite(longitudeBucket) &&
    Number.isFinite(gridDegrees) &&
    gridDegrees > 0
    ? { latitudeBucket, longitudeBucket, gridDegrees }
    : null;
}

function isValidLocalDateTime(value: string): boolean {
  const withoutFraction = value.split(".", 1)[0]!;
  const match = withoutFraction.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/u,
  );
  if (match === null) return false;
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
