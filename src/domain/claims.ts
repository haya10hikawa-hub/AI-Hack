import { z } from "zod";

import { JsonValueSchema, jsonValuesEqual, type JsonValue } from "./json";

export const ClaimOriginSchema = z.enum(["deterministic", "ai", "user"]);
export const ClaimConfidenceSchema = z.enum([
  "low",
  "medium",
  "high",
  "unsupported",
]);
export const ClaimConfirmationSchema = z.enum([
  "unconfirmed",
  "user_confirmed",
  "disputed",
]);
export const ClaimStatusSchema = z.enum([
  "generated",
  "active",
  "superseded",
  "rejected",
  "disputed",
  "unsupported",
  "deleted",
]);

export const ClaimSchema = z
  .object({
    id: z.string().min(1).max(200),
    userId: z.string().min(1).max(200),
    memoryId: z.string().min(1).max(200),
    field: z.string().trim().min(1).max(80),
    value: JsonValueSchema,
    origin: ClaimOriginSchema,
    confidenceBand: ClaimConfidenceSchema,
    confirmationStatus: ClaimConfirmationSchema,
    status: ClaimStatusSchema,
    evidenceIds: z.array(z.string().min(1).max(200)).max(100).default([]),
    aiRunId: z.string().min(1).max(200).nullable().default(null),
    sourceCorrectionId: z.string().min(1).max(200).nullable().default(null),
    dedupeKey: z.string().min(1).max(200).nullable().default(null),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Claim = z.infer<typeof ClaimSchema>;

export const UserCorrectionActionSchema = z.enum([
  "confirm",
  "replace",
  "reject",
  "resolve",
]);

export const UserCorrectionSchema = z
  .object({
    id: z.string().min(1).max(200),
    userId: z.string().min(1).max(200),
    memoryId: z.string().min(1).max(200),
    targetClaimId: z.string().min(1).max(200),
    action: UserCorrectionActionSchema,
    value: JsonValueSchema.nullable(),
    createdClaimId: z.string().min(1).max(200).nullable(),
    idempotencyKey: z.string().min(1).max(200),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type UserCorrection = z.infer<typeof UserCorrectionSchema>;

export interface ClaimInvariantResult {
  valid: boolean;
  violations: string[];
}

export function validateClaimInvariant(rawClaim: Claim): ClaimInvariantResult {
  const claim = ClaimSchema.parse(rawClaim);
  const violations: string[] = [];

  if (
    claim.origin !== "user" &&
    claim.status === "active" &&
    claim.evidenceIds.length === 0
  ) {
    violations.push("active_observation_claim_requires_evidence");
  }
  if (
    claim.origin !== "user" &&
    claim.confirmationStatus === "user_confirmed"
  ) {
    violations.push("non_user_claim_cannot_be_directly_user_confirmed");
  }
  if (
    claim.origin === "ai" &&
    claim.status === "active" &&
    claim.aiRunId === null
  ) {
    violations.push("active_ai_claim_requires_ai_run");
  }
  if (
    claim.origin === "user" &&
    claim.status === "active" &&
    (claim.confirmationStatus !== "user_confirmed" ||
      claim.sourceCorrectionId === null)
  ) {
    violations.push("active_user_claim_requires_correction_provenance");
  }
  if (
    claim.confidenceBand === "unsupported" &&
    claim.status !== "unsupported" &&
    claim.status !== "deleted"
  ) {
    violations.push("unsupported_confidence_requires_unsupported_status");
  }
  if (claim.status === "disputed" && claim.confirmationStatus !== "disputed") {
    violations.push("disputed_claim_requires_disputed_confirmation");
  }
  if (claim.status === "active" && claim.confirmationStatus === "disputed") {
    violations.push("active_claim_cannot_be_disputed");
  }

  return { valid: violations.length === 0, violations };
}

export interface UserCorrectionTransitionInput {
  targetClaim: Claim;
  action: z.infer<typeof UserCorrectionActionSchema>;
  value?: JsonValue;
  correctionId: string;
  idempotencyKey?: string;
  newClaimId?: string;
  occurredAt: string;
  existingClaims?: readonly Claim[];
}

export interface UserCorrectionTransition {
  correction: UserCorrection;
  targetClaim: Claim;
  newClaim: Claim | null;
  conflictingClaimUpdates: Claim[];
  memoryBecomesDisputed: boolean;
}

export class ClaimTransitionError extends Error {
  constructor(
    readonly code:
      | "invalid_target_state"
      | "missing_value"
      | "missing_new_claim_id"
      | "duplicate_confirmation"
      | "ownership_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ClaimTransitionError";
  }
}

/**
 * Creates the append-only correction and a new user-origin claim. It never
 * mutates the supplied AI/deterministic claim or its evidence.
 */
export function applyUserCorrection(
  input: UserCorrectionTransitionInput,
): UserCorrectionTransition {
  const target = ClaimSchema.parse(input.targetClaim);
  const action = UserCorrectionActionSchema.parse(input.action);
  const occurredAt = z
    .string()
    .datetime({ offset: true })
    .parse(input.occurredAt);
  const correctionId = z.string().min(1).max(200).parse(input.correctionId);
  const existingClaims = (input.existingClaims ?? []).map((claim) =>
    ClaimSchema.parse(claim),
  );

  if (!["generated", "active", "disputed"].includes(target.status)) {
    throw new ClaimTransitionError(
      "invalid_target_state",
      `A ${target.status} claim cannot be corrected.`,
    );
  }
  if (
    action === "confirm" &&
    target.origin === "user" &&
    target.confirmationStatus === "user_confirmed"
  ) {
    throw new ClaimTransitionError(
      "duplicate_confirmation",
      "A user-confirmed claim cannot be confirmed again.",
    );
  }
  if (action === "resolve" && target.status !== "disputed") {
    throw new ClaimTransitionError(
      "invalid_target_state",
      "Resolve requires a disputed target claim.",
    );
  }
  for (const claim of existingClaims) {
    if (claim.userId !== target.userId || claim.memoryId !== target.memoryId) {
      throw new ClaimTransitionError(
        "ownership_mismatch",
        "All claims in a correction transaction must share owner and memory.",
      );
    }
  }

  if (action === "reject") {
    const correction = UserCorrectionSchema.parse({
      id: correctionId,
      userId: target.userId,
      memoryId: target.memoryId,
      targetClaimId: target.id,
      action,
      value: null,
      createdClaimId: null,
      idempotencyKey: input.idempotencyKey ?? correctionId,
      createdAt: occurredAt,
    });
    return {
      correction,
      targetClaim: { ...target, status: "rejected", updatedAt: occurredAt },
      newClaim: null,
      conflictingClaimUpdates: [],
      memoryBecomesDisputed: false,
    };
  }

  const value = action === "confirm" ? target.value : input.value;
  if (value === undefined) {
    throw new ClaimTransitionError(
      "missing_value",
      `${action} requires a replacement value.`,
    );
  }
  const parsedValue = JsonValueSchema.parse(value);
  if (input.newClaimId === undefined) {
    throw new ClaimTransitionError(
      "missing_new_claim_id",
      `${action} requires a new user-origin claim id.`,
    );
  }
  const newClaimId = z.string().min(1).max(200).parse(input.newClaimId);

  const activeUserClaims = existingClaims.filter(
    (claim) =>
      claim.id !== target.id &&
      claim.field === target.field &&
      claim.origin === "user" &&
      claim.status === "active" &&
      claim.confirmationStatus === "user_confirmed",
  );
  if (
    activeUserClaims.some((claim) => jsonValuesEqual(claim.value, parsedValue))
  ) {
    throw new ClaimTransitionError(
      "duplicate_confirmation",
      "An equivalent user-confirmed claim already exists.",
    );
  }

  const hasConflict =
    action !== "resolve" &&
    activeUserClaims.some(
      (claim) => !jsonValuesEqual(claim.value, parsedValue),
    );
  const correction = UserCorrectionSchema.parse({
    id: correctionId,
    userId: target.userId,
    memoryId: target.memoryId,
    targetClaimId: target.id,
    action,
    value: parsedValue,
    createdClaimId: newClaimId,
    idempotencyKey: input.idempotencyKey ?? correctionId,
    createdAt: occurredAt,
  });
  const newClaim = ClaimSchema.parse({
    id: newClaimId,
    userId: target.userId,
    memoryId: target.memoryId,
    field: target.field,
    value: parsedValue,
    origin: "user",
    confidenceBand: "high",
    confirmationStatus: hasConflict ? "disputed" : "user_confirmed",
    status: hasConflict ? "disputed" : "active",
    evidenceIds: [],
    aiRunId: null,
    sourceCorrectionId: correction.id,
    dedupeKey: input.idempotencyKey ?? correction.id,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  const targetClaim = ClaimSchema.parse({
    ...target,
    status: "superseded",
    updatedAt: occurredAt,
  });
  const claimsToResolve = existingClaims.filter(
    (claim) =>
      claim.id !== target.id &&
      claim.field === target.field &&
      claim.origin === "user" &&
      (claim.status === "active" || claim.status === "disputed"),
  );
  const conflictingClaimUpdates = hasConflict
    ? activeUserClaims.map((claim) =>
        ClaimSchema.parse({
          ...claim,
          status: "disputed",
          confirmationStatus: "disputed",
          updatedAt: occurredAt,
        }),
      )
    : action === "resolve"
      ? claimsToResolve.map((claim) =>
          ClaimSchema.parse({
            ...claim,
            status: "superseded",
            updatedAt: occurredAt,
          }),
        )
      : [];

  return {
    correction,
    targetClaim,
    newClaim,
    conflictingClaimUpdates,
    memoryBecomesDisputed: hasConflict,
  };
}

export function assertClaimInvariant(claim: Claim): void {
  const result = validateClaimInvariant(claim);
  if (!result.valid) {
    throw new Error(
      `Claim invariant violation: ${result.violations.join(", ")}`,
    );
  }
}
