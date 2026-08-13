import { z } from "zod";

import {
  ClaimSchema,
  UserCorrectionSchema,
  validateClaimInvariant,
  type Claim,
  type UserCorrection,
} from "./claims";
import { JsonValueSchema, jsonValuesEqual, type JsonValue } from "./json";

export const EvidenceReferenceSchema = z
  .object({
    id: z.string().min(1).max(200),
    userId: z.string().min(1).max(200),
    memoryId: z.string().min(1).max(200),
    sourceType: z.enum([
      "metadata",
      "ai_observation",
      "user_statement",
      "calendar",
      "location",
      "system",
    ]),
    validity: z.enum(["valid", "uncertain", "invalid", "deleted"]),
  })
  .strict();

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export interface GroundedFact {
  claimId: string;
  field: string;
  value: JsonValue;
  truthLayer: "deterministic" | "ai_inference" | "user_confirmed";
  provenance:
    | { kind: "evidence"; evidenceIds: string[] }
    | { kind: "user_correction"; correctionId: string };
}

export interface GroundingRejection {
  claimId: string;
  reason:
    | "memory_not_active"
    | "claim_not_active"
    | "claim_disputed"
    | "claim_unsupported"
    | "claim_invariant_failed"
    | "missing_valid_evidence"
    | "missing_user_correction";
}

export function collectGroundedFacts(input: {
  memoryId: string;
  memoryStatus: "draft" | "active" | "disputed" | "deleting" | "deleted";
  claims: readonly Claim[];
  evidence: readonly EvidenceReference[];
  corrections: readonly UserCorrection[];
}): { facts: GroundedFact[]; rejected: GroundingRejection[] } {
  const evidenceById = new Map(
    input.evidence.map((rawEvidence) => {
      const evidence = EvidenceReferenceSchema.parse(rawEvidence);
      return [evidence.id, evidence] as const;
    }),
  );
  const correctionById = new Map(
    input.corrections.map((rawCorrection) => {
      const correction = UserCorrectionSchema.parse(rawCorrection);
      return [correction.id, correction] as const;
    }),
  );
  const facts: GroundedFact[] = [];
  const rejected: GroundingRejection[] = [];

  for (const rawClaim of input.claims) {
    const claim = ClaimSchema.parse(rawClaim);
    const reject = (reason: GroundingRejection["reason"]) => {
      rejected.push({ claimId: claim.id, reason });
    };

    if (input.memoryStatus !== "active" || claim.memoryId !== input.memoryId) {
      reject("memory_not_active");
      continue;
    }
    if (
      claim.status === "disputed" ||
      claim.confirmationStatus === "disputed"
    ) {
      reject("claim_disputed");
      continue;
    }
    if (
      claim.status === "unsupported" ||
      claim.confidenceBand === "unsupported" ||
      (claim.origin !== "user" && claim.confidenceBand === "low")
    ) {
      reject("claim_unsupported");
      continue;
    }
    if (claim.status !== "active") {
      reject("claim_not_active");
      continue;
    }
    if (!validateClaimInvariant(claim).valid) {
      reject("claim_invariant_failed");
      continue;
    }

    if (claim.origin === "user") {
      const correction =
        claim.sourceCorrectionId === null
          ? undefined
          : correctionById.get(claim.sourceCorrectionId);
      if (
        correction === undefined ||
        correction.createdClaimId !== claim.id ||
        correction.memoryId !== input.memoryId ||
        correction.userId !== claim.userId ||
        correction.action === "reject"
      ) {
        reject("missing_user_correction");
        continue;
      }
      facts.push({
        claimId: claim.id,
        field: claim.field,
        value: claim.value,
        truthLayer: "user_confirmed",
        provenance: { kind: "user_correction", correctionId: correction.id },
      });
      continue;
    }

    const referencedEvidence = claim.evidenceIds.map((id) =>
      evidenceById.get(id),
    );
    if (
      claim.evidenceIds.length === 0 ||
      referencedEvidence.some(
        (evidence) =>
          evidence === undefined ||
          evidence.validity !== "valid" ||
          evidence.memoryId !== input.memoryId ||
          evidence.userId !== claim.userId,
      )
    ) {
      reject("missing_valid_evidence");
      continue;
    }
    facts.push({
      claimId: claim.id,
      field: claim.field,
      value: claim.value,
      truthLayer: claim.origin === "ai" ? "ai_inference" : "deterministic",
      provenance: { kind: "evidence", evidenceIds: [...claim.evidenceIds] },
    });
  }

  // Fail closed if inconsistent persisted state contains competing confirmed
  // values, even if the database transition guard was bypassed.
  const confirmedByField = new Map<string, GroundedFact[]>();
  for (const fact of facts.filter(
    ({ truthLayer }) => truthLayer === "user_confirmed",
  )) {
    confirmedByField.set(fact.field, [
      ...(confirmedByField.get(fact.field) ?? []),
      fact,
    ]);
  }
  const conflictingFields = new Set<string>();
  for (const [field, confirmedFacts] of confirmedByField) {
    const first = confirmedFacts[0];
    if (
      first !== undefined &&
      confirmedFacts.some((fact) => !jsonValuesEqual(fact.value, first.value))
    ) {
      conflictingFields.add(field);
      for (const fact of confirmedFacts) {
        rejected.push({ claimId: fact.claimId, reason: "claim_disputed" });
      }
    }
  }

  // User-confirmed context wins over inference for the same field.
  const confirmedFields = new Set(
    facts
      .filter(({ truthLayer }) => truthLayer === "user_confirmed")
      .map(({ field }) => field),
  );
  return {
    facts: facts.filter(
      (fact) =>
        !conflictingFields.has(fact.field) &&
        (fact.truthLayer === "user_confirmed" ||
          !confirmedFields.has(fact.field)),
    ),
    rejected,
  };
}

export const GroundedAnswerOutputSchema = z
  .object({
    mode: z.enum(["answer", "unknown", "clarification"]),
    segments: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(500),
            claimIds: z.array(z.string().min(1).max(200)).min(1).max(10),
          })
          .strict(),
      )
      .max(10),
    unknownReason: z
      .enum([
        "no_candidate",
        "no_grounded_claim",
        "insufficient_context",
        "conflict",
      ])
      .nullable(),
    clarificationQuestion: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.mode === "answer" && answer.segments.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["segments"],
        message: "An answer must contain at least one grounded segment.",
      });
    }
    if (
      answer.mode === "answer" &&
      (answer.unknownReason !== null || answer.clarificationQuestion !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Answer mode cannot also be unknown or ask a clarification.",
      });
    }
    if (
      answer.mode === "unknown" &&
      (answer.unknownReason === null || answer.clarificationQuestion !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unknown mode requires one unknown reason and no question.",
      });
    }
    if (answer.mode !== "answer" && answer.segments.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["segments"],
        message: "Unknown and clarification responses cannot assert facts.",
      });
    }
    if (answer.mode === "clarification" && answer.unknownReason !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unknownReason"],
        message: "Clarification mode cannot also declare an unknown reason.",
      });
    }
    if (
      answer.mode === "clarification" &&
      answer.clarificationQuestion === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clarificationQuestion"],
        message: "Clarification mode requires one question.",
      });
    }
  });

export type GroundedAnswerOutput = z.infer<typeof GroundedAnswerOutputSchema>;

export interface ValidatedGroundedAnswer extends GroundedAnswerOutput {
  provenance: Record<string, GroundedFact>;
}

export function validateGroundedAnswerOutput(
  rawOutput: unknown,
  allowedFacts: readonly GroundedFact[],
): ValidatedGroundedAnswer {
  // Validation and rendering are one boundary: no caller can accidentally
  // mark model-authored prose as grounded merely because it cites a valid id.
  const answer = canonicalizeGroundedAnswerText(rawOutput, allowedFacts);
  const facts = new Map(
    allowedFacts.map((fact) => [fact.claimId, fact] as const),
  );
  const referenced = new Set(
    answer.segments.flatMap(({ claimIds }) => claimIds),
  );

  for (const claimId of referenced) {
    if (!facts.has(claimId)) {
      throw new Error(
        `Grounded answer referenced an ineligible claim: ${claimId}`,
      );
    }
  }

  const provenance: Record<string, GroundedFact> = {};
  for (const claimId of referenced) {
    provenance[claimId] = facts.get(claimId)!;
  }
  return { ...answer, provenance };
}

/**
 * Discards model-authored factual prose and renders only the selected,
 * validated facts. The model may choose relevant claim ids; it may not invent
 * the sentence that is ultimately shown as grounded truth.
 */
export function canonicalizeGroundedAnswerText(
  rawOutput: unknown,
  allowedFacts: readonly Pick<GroundedFact, "claimId" | "field" | "value">[],
): GroundedAnswerOutput {
  const answer = GroundedAnswerOutputSchema.parse(rawOutput);
  if (answer.mode !== "answer") return answer;

  const facts = new Map(
    allowedFacts.map((fact) => [fact.claimId, fact] as const),
  );
  const seenSegments = new Set<string>();
  const segments = answer.segments.flatMap((segment) => {
    const claimIds = [...new Set(segment.claimIds)];
    const selectedFacts = claimIds.map((claimId) => facts.get(claimId));
    if (selectedFacts.some((fact) => fact === undefined)) {
      throw new Error("Grounded answer selected an ineligible claim.");
    }
    const renderedFacts = selectedFacts.map((fact, index) => ({
      claimId: claimIds[index]!,
      text: `${factLabel(fact!.field)}：${displayFactValue(fact!.value)}`,
    }));
    const included: typeof renderedFacts = [];
    for (const rendered of renderedFacts) {
      const candidateText = [...included, rendered]
        .map(({ text }) => text)
        .join("、");
      if (candidateText.length > 500) break;
      included.push(rendered);
    }
    const text = included.map((rendered) => rendered.text).join("、");
    if (seenSegments.has(text)) return [];
    seenSegments.add(text);
    return [{ text, claimIds: included.map(({ claimId }) => claimId) }];
  });

  if (segments.length === 0) {
    throw new Error("Grounded answer did not select a usable fact.");
  }
  return GroundedAnswerOutputSchema.parse({ ...answer, segments });
}

export const GroundedFactInputSchema = z
  .object({
    claimId: z.string().min(1).max(200),
    field: z.string().min(1).max(80),
    value: JsonValueSchema,
    truthLayer: z.enum(["deterministic", "ai_inference", "user_confirmed"]),
  })
  .strict();

function factLabel(field: string): string {
  const labels: Record<string, string> = {
    time: "日時",
    captured_at: "日時",
    location: "場所",
    coarse_place: "場所",
    activity: "活動",
    purpose: "目的",
    people: "人物",
    result: "結果",
    meaning: "意味",
    media_count: "写真",
  };
  // Unknown field names can originate in an inference Claim. Keep the label
  // neutral so an arbitrary field name cannot become model-authored prose in
  // an otherwise deterministic grounded answer.
  return labels[field] ?? "情報";
}

function displayFactValue(value: JsonValue): string {
  if (typeof value === "string") return boundedText(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "不明";
  if (Array.isArray(value)) {
    const rendered = value.slice(0, 5).map(displayFactValue).filter(Boolean);
    return rendered.length > 0 ? rendered.join("、") : "不明";
  }
  for (const key of [
    "label",
    "value",
    "text",
    "name",
    "activity",
    "purpose",
    "grid",
    "count",
  ]) {
    const candidate = value[key];
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return boundedText(String(candidate));
    }
  }
  return boundedText(JSON.stringify(value));
}

function boundedText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? "不明" : normalized.slice(0, 300);
}
