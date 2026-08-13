import { z } from "zod";

import { JsonValueSchema } from "./json";

export const ImportanceBandSchema = z.enum(["low", "medium", "high"]);
export type ImportanceBand = z.infer<typeof ImportanceBandSchema>;

export const ContextDimensionSchema = z.enum([
  "time",
  "location",
  "activity",
  "purpose",
  "people",
  "result",
  "meaning",
]);
export type ContextDimension = z.infer<typeof ContextDimensionSchema>;

export const ContextStatusSchema = z.enum([
  "known",
  "missing",
  "unknown",
  "not_applicable",
]);
export type ContextStatus = z.infer<typeof ContextStatusSchema>;

export const ContextDimensionStateSchema = z
  .object({
    dimension: ContextDimensionSchema,
    status: ContextStatusSchema,
    importanceWeight: z.number().int().min(1).max(5).default(1),
    activeClaimId: z.string().min(1).max(200).nullable().default(null),
  })
  .strict();

export type ContextDimensionState = z.infer<typeof ContextDimensionStateSchema>;

export const ImportanceSignalsSchema = z
  .object({
    photoCount: z.number().int().min(0).max(10_000),
    sequenceDurationMinutes: z
      .number()
      .min(0)
      .max(60 * 24 * 31),
    unusualLocation: z.boolean().default(false),
    temporalDensity: z.number().min(0).max(1).default(0),
    visualChange: z.number().min(0).max(1).default(0),
    relatedConfirmedMemories: z.number().int().min(0).max(10_000).default(0),
    repeatedUserInteractions: z.number().int().min(0).max(10_000).default(0),
    aiContextSignal: z
      .object({
        band: ImportanceBandSchema,
        evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(20),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export type ImportanceSignals = z.infer<typeof ImportanceSignalsSchema>;

export interface ImportanceAssessment {
  band: ImportanceBand;
  /** Processing-priority score, not a judgment of personal or life value. */
  priorityScore: number;
  reasons: Array<{
    signal: string;
    contribution: number;
  }>;
}

export function assessMemoryImportance(
  rawSignals: ImportanceSignals,
): ImportanceAssessment {
  const signals = ImportanceSignalsSchema.parse(rawSignals);
  const reasons: ImportanceAssessment["reasons"] = [];
  const add = (signal: string, contribution: number) => {
    if (contribution > 0) reasons.push({ signal, contribution });
  };

  add(
    "photo_count",
    signals.photoCount >= 10 ? 2 : signals.photoCount >= 4 ? 1 : 0,
  );
  add(
    "sequence_duration",
    signals.sequenceDurationMinutes >= 120
      ? 2
      : signals.sequenceDurationMinutes >= 30
        ? 1
        : 0,
  );
  add("unusual_location", signals.unusualLocation ? 1 : 0);
  add("temporal_density", signals.temporalDensity >= 0.65 ? 1 : 0);
  add("visual_change", signals.visualChange >= 0.65 ? 1 : 0);
  add(
    "related_confirmed_memories",
    Math.min(2, signals.relatedConfirmedMemories),
  );
  add(
    "repeated_user_interaction",
    Math.min(2, Math.floor(signals.repeatedUserInteractions / 2)),
  );

  // AI can only nudge deterministic priority, and only when it cites evidence.
  if (signals.aiContextSignal !== null) {
    add(
      "evidence_backed_ai_context",
      signals.aiContextSignal.band === "high"
        ? 1
        : signals.aiContextSignal.band === "medium"
          ? 0.5
          : 0,
    );
  }

  const priorityScore = reasons.reduce(
    (sum, reason) => sum + reason.contribution,
    0,
  );
  return {
    band: priorityScore >= 7 ? "high" : priorityScore >= 3 ? "medium" : "low",
    priorityScore,
    reasons,
  };
}

export interface ContextCompletenessAssessment {
  dimensions: ContextDimensionState[];
  knownWeight: number;
  applicableWeight: number;
  knownRatio: number;
  band: "sparse" | "partial" | "sufficient";
  missingDimensions: ContextDimension[];
}

export function assessContextCompleteness(
  rawDimensions: readonly ContextDimensionState[],
): ContextCompletenessAssessment {
  const dimensions = rawDimensions.map((dimension) =>
    ContextDimensionStateSchema.parse(dimension),
  );
  const unique = new Set(dimensions.map(({ dimension }) => dimension));
  if (unique.size !== dimensions.length) {
    throw new Error("Each context dimension may appear only once.");
  }

  const applicable = dimensions.filter(
    ({ status }) => status !== "not_applicable",
  );
  const applicableWeight = applicable.reduce(
    (sum, dimension) => sum + dimension.importanceWeight,
    0,
  );
  const knownWeight = applicable
    .filter(
      ({ status, activeClaimId }) =>
        status === "known" && activeClaimId !== null,
    )
    .reduce((sum, dimension) => sum + dimension.importanceWeight, 0);
  const knownRatio =
    applicableWeight === 0 ? 1 : knownWeight / applicableWeight;

  return {
    dimensions,
    knownWeight,
    applicableWeight,
    knownRatio: Math.round(knownRatio * 1000) / 1000,
    band:
      knownRatio >= 0.65
        ? "sufficient"
        : knownRatio >= 0.3
          ? "partial"
          : "sparse",
    missingDimensions: applicable
      .filter(({ status }) => status === "missing")
      .sort((left, right) => right.importanceWeight - left.importanceWeight)
      .map(({ dimension }) => dimension),
  };
}

export const MemoryGapTypeSchema = z.enum([
  "purpose",
  "event_type",
  "result",
  "people",
  "context",
]);

export const GapOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(80),
  })
  .strict();

export const MemoryGapCandidateSchema = z
  .object({
    id: z.string().min(1).max(200),
    dimension: ContextDimensionSchema,
    gapType: MemoryGapTypeSchema,
    question: z.string().trim().min(1).max(200),
    options: z.array(GapOptionSchema).min(2).max(5),
    candidateOptionValue: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .nullable()
      .default(null),
    // Required by AI persistence; nullable/defaults keep the pure gate usable
    // for deterministic question sources which have no provisional Claim.
    candidateValue: JsonValueSchema.nullable().default(null),
    evidenceIds: z.array(z.string().min(1).max(200)).max(20).default([]),
    confidenceBand: z.enum(["low", "medium", "high"]),
    candidateSpecificity: z.number().min(0).max(1),
    askedCount: z.number().int().min(0).max(100).default(0),
    status: z
      .enum([
        "detected",
        "ready_to_ask",
        "deferred",
        "resolved",
        "skipped",
        "dismissed",
      ])
      .default("detected"),
  })
  .strict();

export type MemoryGapCandidate = z.infer<typeof MemoryGapCandidateSchema>;

export type MemoryGapGateDecision =
  | {
      ready: true;
      candidate: MemoryGapCandidate;
      reason: "valuable_narrow_gap";
    }
  | {
      ready: false;
      candidate: null;
      reason:
        | "importance_too_low"
        | "no_missing_context"
        | "no_eligible_candidate"
        | "candidate_too_ambiguous";
    };

/** Returns at most one non-blocking question. */
export function evaluateMemoryGapGate(input: {
  importance: ImportanceBand;
  completeness: ContextCompletenessAssessment;
  candidates: readonly z.input<typeof MemoryGapCandidateSchema>[];
}): MemoryGapGateDecision {
  const importance = ImportanceBandSchema.parse(input.importance);
  if (importance === "low") {
    return { ready: false, candidate: null, reason: "importance_too_low" };
  }
  if (input.completeness.missingDimensions.length === 0) {
    return { ready: false, candidate: null, reason: "no_missing_context" };
  }

  const missing = new Set(input.completeness.missingDimensions);
  const eligible = input.candidates
    .map((candidate) => MemoryGapCandidateSchema.parse(candidate))
    .filter(
      (candidate) =>
        missing.has(candidate.dimension) &&
        candidate.askedCount === 0 &&
        (candidate.status === "detected" ||
          candidate.status === "ready_to_ask"),
    )
    .sort((left, right) => {
      const confidence = { low: 0, medium: 1, high: 2 } as const;
      return (
        confidence[right.confidenceBand] - confidence[left.confidenceBand] ||
        right.candidateSpecificity - left.candidateSpecificity ||
        left.id.localeCompare(right.id)
      );
    });

  if (eligible.length === 0) {
    return { ready: false, candidate: null, reason: "no_eligible_candidate" };
  }

  const candidate = eligible[0]!;
  const narrowEnough =
    candidate.candidateSpecificity >= 0.8 ||
    (candidate.candidateSpecificity >= 0.65 &&
      candidate.confidenceBand === "high");
  if (!narrowEnough || candidate.confidenceBand === "low") {
    return { ready: false, candidate: null, reason: "candidate_too_ambiguous" };
  }

  return { ready: true, candidate, reason: "valuable_narrow_gap" };
}
