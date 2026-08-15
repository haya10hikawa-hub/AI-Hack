import { z } from "zod";

import { AssetSemanticRepresentationSchema } from "./event-semantics";

const CandidateSchema = z
  .object({
    assetId: z.string().min(1).max(200),
    capturedAt: z.string().datetime({ offset: true }).nullable(),
    semantics: AssetSemanticRepresentationSchema,
  })
  .strict()
  .refine(({ assetId, semantics }) => assetId === semantics.assetId, {
    message: "Candidate and semantic asset ids must match.",
  });

export type MemoryRepresentativeRole = "identity" | "key_moment" | "complement";
export interface MemoryRepresentative {
  assetId: string;
  role: MemoryRepresentativeRole;
  reason: string;
}

const roles: readonly MemoryRepresentativeRole[] = [
  "identity",
  "key_moment",
  "complement",
];

/** Exhaustively scores at most four candidates; role order is also the fallback order. */
export function distillMemoryRepresentatives(
  input: readonly unknown[],
): MemoryRepresentative[] {
  const candidates = input.map((value) => CandidateSchema.parse(value));
  if (
    new Set(candidates.map(({ assetId }) => assetId)).size !== candidates.length
  ) {
    throw new Error("Distillation candidates require unique asset ids.");
  }
  const assignments = permutations(candidates, Math.min(3, candidates.length));
  const ranked = assignments
    .map((items) => ({
      items,
      score:
        identityScore(items[0]!, candidates) +
        (items[1] ? keyMomentScore(items[1], items[0]!) : 0) +
        (items[2] ? complementScore(items[2], items[0]!, items[1]!) : 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        tieKey(left.items).localeCompare(tieKey(right.items)),
    );
  return (ranked[0]?.items ?? []).map(({ assetId }, index) => ({
    assetId,
    role: roles[index]!,
    reason: `domain-score-v1:${roles[index]}`,
  }));
}

function identityScore(candidate: Candidate, all: Candidate[]): number {
  const keys = facetKeys(candidate);
  const context = candidate.semantics.facets.filter(
    ({ type, confidenceBand }) =>
      confidenceBand !== "low" &&
      ["environment", "people_group", "visible_text"].includes(type),
  ).length;
  const quality = candidate.semantics.facets.reduce(
    (sum, facet) =>
      sum +
      (facet.confidenceBand === "high"
        ? 2
        : facet.confidenceBand === "medium"
          ? 1
          : 0),
    0,
  );
  const redundancy = Math.max(
    0,
    ...all
      .filter((item) => item !== candidate)
      .map((item) => overlap(keys, facetKeys(item))),
  );
  return keys.size * 4 + context * 3 + quality - redundancy * 4;
}

function keyMomentScore(candidate: Candidate, identity: Candidate): number {
  const facets = candidate.semantics.facets.filter(
    ({ confidenceBand }) => confidenceBand !== "low",
  );
  const activity = facets.filter(({ type }) => type === "activity").length * 6;
  const moments = facets.filter(({ type }) => type === "moment").length * 4;
  const salience =
    facets.filter(
      ({ type, confidenceBand }) =>
        confidenceBand === "high" && ["activity", "moment"].includes(type),
    ).length * 2;
  return (
    activity +
    moments +
    facets.length +
    salience -
    overlap(facetKeys(candidate), facetKeys(identity)) * 5
  );
}

function complementScore(
  candidate: Candidate,
  identity: Candidate,
  keyMoment: Candidate,
): number {
  const covered = new Set([...facetKeys(identity), ...facetKeys(keyMoment)]);
  const keys = facetKeys(candidate);
  const marginal = [...keys].filter((key) => !covered.has(key)).length * 5;
  const detail = candidate.semantics.facets
    .filter(
      ({ type, confidenceBand }) =>
        confidenceBand !== "low" &&
        ["detail", "object", "visible_text"].includes(type),
    )
    .reduce(
      (sum, { type }) =>
        sum + (type === "detail" ? 4 : type === "object" ? 2 : 1),
      0,
    );
  const temporal = temporalDiversity(candidate, identity, keyMoment);
  const redundancy =
    Math.max(
      overlap(keys, facetKeys(identity)),
      overlap(keys, facetKeys(keyMoment)),
    ) * 5;
  return marginal + detail + temporal - redundancy;
}

type Candidate = z.infer<typeof CandidateSchema>;
const facetKeys = (candidate: Candidate) =>
  new Set(
    candidate.semantics.facets
      .filter(({ confidenceBand }) => confidenceBand !== "low")
      .map(({ type, value }) => `${type}\0${value.toLocaleLowerCase("en-US")}`),
  );
const overlap = (left: Set<string>, right: Set<string>) =>
  left.size === 0 || right.size === 0
    ? 0
    : [...left].filter((key) => right.has(key)).length /
      new Set([...left, ...right]).size;
const temporalDiversity = (candidate: Candidate, ...selected: Candidate[]) => {
  if (
    candidate.capturedAt === null ||
    selected.some(({ capturedAt }) => capturedAt === null)
  )
    return 0;
  return Math.min(
    5,
    Math.min(
      ...selected.map(({ capturedAt }) =>
        Math.abs(Date.parse(candidate.capturedAt!) - Date.parse(capturedAt!)),
      ),
    ) / 3_600_000,
  );
};
const tieKey = (items: Candidate[]) =>
  items
    .map(({ capturedAt, assetId }) => `${capturedAt ?? "9999"}\0${assetId}`)
    .join("\0");
function permutations<T>(values: T[], length: number): T[][] {
  if (length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(
      values.filter((_, itemIndex) => itemIndex !== index),
      length - 1,
    ).map((tail) => [value, ...tail]),
  );
}
