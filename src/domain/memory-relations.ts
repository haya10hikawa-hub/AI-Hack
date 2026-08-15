import { z } from "zod";

import { JsonValueSchema, type JsonValue } from "./json";

export const MemoryRelationTypeSchema = z.enum([
  "before",
  "same_place",
  "same_activity",
]);

export type MemoryRelationType = z.infer<typeof MemoryRelationTypeSchema>;

export const MemoryRelationClaimSchema = z
  .object({
    id: z.string().min(1).max(200),
    field: z.string().trim().min(1).max(80),
    value: JsonValueSchema,
    origin: z.enum(["deterministic", "ai", "user"]),
    confidenceBand: z.enum(["low", "medium", "high", "unsupported"]),
    confirmationStatus: z.enum(["unconfirmed", "user_confirmed", "disputed"]),
    status: z.enum([
      "generated",
      "active",
      "superseded",
      "rejected",
      "disputed",
      "unsupported",
      "deleted",
    ]),
  })
  .strict();

export const RelationMemorySchema = z
  .object({
    id: z.string().min(1).max(200),
    userId: z.string().min(1).max(200),
    capturedAt: z.string().datetime({ offset: true }).nullable(),
    coarsePlace: z.string().trim().min(1).max(240).nullable(),
    claims: z.array(MemoryRelationClaimSchema).max(100).default([]),
  })
  .strict();

export type RelationMemory = z.infer<typeof RelationMemorySchema>;

export interface DerivedMemoryRelation {
  sourceMemoryId: string;
  targetMemoryId: string;
  relationType: MemoryRelationType;
  confidenceBand: "high";
  reason: JsonValue;
}

/** Derives only bounded, exact relations; no fuzzy or visual inference. */
export function deriveMemoryRelations(
  rawCurrent: RelationMemory,
  rawCandidates: readonly RelationMemory[],
): DerivedMemoryRelation[] {
  const current = RelationMemorySchema.parse(rawCurrent);
  const candidates = rawCandidates
    .slice(0, 50)
    .map((candidate) => RelationMemorySchema.parse(candidate))
    .filter((candidate) => candidate.id !== current.id);
  if (candidates.some(({ userId }) => userId !== current.userId)) {
    throw new Error("Relation candidates must share one owner.");
  }

  const relations: DerivedMemoryRelation[] = [];
  const dated = candidates.filter((candidate) => candidate.capturedAt !== null);
  if (current.capturedAt !== null) {
    const currentTime = Date.parse(current.capturedAt);
    const earlier = dated
      .filter((candidate) => Date.parse(candidate.capturedAt!) < currentTime)
      .sort(
        (left, right) =>
          Date.parse(right.capturedAt!) - Date.parse(left.capturedAt!),
      )[0];
    const later = dated
      .filter((candidate) => Date.parse(candidate.capturedAt!) > currentTime)
      .sort(
        (left, right) =>
          Date.parse(left.capturedAt!) - Date.parse(right.capturedAt!),
      )[0];
    for (const candidate of [earlier, later]) {
      if (candidate === undefined) continue;
      const currentIsEarlier = currentTime < Date.parse(candidate.capturedAt!);
      relations.push({
        sourceMemoryId: currentIsEarlier ? current.id : candidate.id,
        targetMemoryId: currentIsEarlier ? candidate.id : current.id,
        relationType: "before",
        confidenceBand: "high",
        reason: { source: "event_timestamp" },
      });
    }
  }

  const currentPlace = normalizeTerm(current.coarsePlace);
  if (currentPlace !== null) {
    for (const candidate of nearestFirst(current, candidates)) {
      if (normalizeTerm(candidate.coarsePlace) !== currentPlace) continue;
      const [sourceMemoryId, targetMemoryId] = canonicalPair(
        current.id,
        candidate.id,
      );
      relations.push({
        sourceMemoryId,
        targetMemoryId,
        relationType: "same_place",
        confidenceBand: "high",
        reason: { source: "coarse_place" },
      });
      if (
        relations.filter(({ relationType }) => relationType === "same_place")
          .length >= 3
      )
        break;
    }
  }

  const currentActivities = eligibleActivities(current);
  if (currentActivities.size > 0) {
    for (const candidate of nearestFirst(current, candidates)) {
      const candidateActivities = eligibleActivities(candidate);
      const shared = [...currentActivities.keys()].find((term) =>
        candidateActivities.has(term),
      );
      if (shared === undefined) continue;
      const [sourceMemoryId, targetMemoryId] = canonicalPair(
        current.id,
        candidate.id,
      );
      relations.push({
        sourceMemoryId,
        targetMemoryId,
        relationType: "same_activity",
        confidenceBand: "high",
        reason: {
          source: "grounded_claims",
          supportingClaimIds: [
            currentActivities.get(shared)!,
            candidateActivities.get(shared)!,
          ],
        },
      });
      if (
        relations.filter(({ relationType }) => relationType === "same_activity")
          .length >= 3
      )
        break;
    }
  }

  return relations.filter(
    (relation, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.sourceMemoryId === relation.sourceMemoryId &&
          candidate.targetMemoryId === relation.targetMemoryId &&
          candidate.relationType === relation.relationType,
      ) === index,
  );
}

function eligibleActivities(memory: RelationMemory): Map<string, string> {
  const activities = new Map<string, string>();
  for (const claim of memory.claims) {
    if (
      claim.field !== "activity" ||
      claim.status !== "active" ||
      claim.confirmationStatus === "disputed" ||
      (claim.origin === "user" &&
        claim.confirmationStatus !== "user_confirmed") ||
      (claim.origin === "ai" &&
        !["medium", "high"].includes(claim.confidenceBand)) ||
      claim.confidenceBand === "unsupported"
    )
      continue;
    const term = relationValue(claim.value);
    if (term !== null && !activities.has(term)) activities.set(term, claim.id);
  }
  return activities;
}

function relationValue(value: JsonValue): string | null {
  if (typeof value === "string") return normalizeTerm(value);
  if (value === null || Array.isArray(value) || typeof value !== "object")
    return null;
  for (const key of ["value", "label", "activity", "name"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string") return normalizeTerm(candidate);
  }
  return null;
}

function normalizeTerm(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, " ").toLowerCase();
  return normalized ? normalized : null;
}

function nearestFirst(
  current: RelationMemory,
  candidates: readonly RelationMemory[],
): RelationMemory[] {
  const currentTime = current.capturedAt
    ? Date.parse(current.capturedAt)
    : null;
  return [...candidates].sort((left, right) => {
    const leftDistance =
      currentTime === null || left.capturedAt === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(Date.parse(left.capturedAt) - currentTime);
    const rightDistance =
      currentTime === null || right.capturedAt === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(Date.parse(right.capturedAt) - currentTime);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  });
}

function canonicalPair(left: string, right: string): [string, string] {
  return left.localeCompare(right) < 0 ? [left, right] : [right, left];
}
