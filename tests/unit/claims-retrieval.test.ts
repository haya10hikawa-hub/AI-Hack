import { describe, expect, it } from "vitest";

import {
  applyUserCorrection,
  validateClaimInvariant,
  type Claim,
} from "@/src/domain/claims";
import {
  collectGroundedFacts,
  validateGroundedAnswerOutput,
} from "@/src/domain/grounded-answer";
import { selectSearchCandidates } from "@/src/domain/search";

const now = "2026-04-12T12:00:00+09:00";

function aiClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "ai-claim",
    userId: "user-a",
    memoryId: "memory-a",
    field: "purpose",
    value: "FTCの練習",
    origin: "ai",
    confidenceBand: "medium",
    confirmationStatus: "unconfirmed",
    status: "active",
    evidenceIds: ["evidence-a"],
    aiRunId: "run-a",
    sourceCorrectionId: null,
    dedupeKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("claim and correction invariants", () => {
  it("rejects active AI claims without evidence and direct confirmation", () => {
    expect(
      validateClaimInvariant(aiClaim({ evidenceIds: [] })).violations,
    ).toContain("active_observation_claim_requires_evidence");
    expect(
      validateClaimInvariant(aiClaim({ confirmationStatus: "user_confirmed" }))
        .violations,
    ).toContain("non_user_claim_cannot_be_directly_user_confirmed");
  });

  it("creates an append-only correction and a distinct user-origin claim", () => {
    const original = aiClaim();
    const result = applyUserCorrection({
      targetClaim: original,
      action: "confirm",
      correctionId: "correction-a",
      newClaimId: "user-claim-a",
      idempotencyKey: "request-a",
      occurredAt: now,
    });
    expect(original.status).toBe("active");
    expect(result.targetClaim.status).toBe("superseded");
    expect(result.correction.createdClaimId).toBe("user-claim-a");
    expect(result.newClaim).toMatchObject({
      origin: "user",
      confirmationStatus: "user_confirmed",
      status: "active",
      sourceCorrectionId: "correction-a",
    });
  });
});

describe("retrieval eligibility and provenance", () => {
  it("prefers a traced user correction over AI inference for the same field", () => {
    const correctionResult = applyUserCorrection({
      targetClaim: aiClaim(),
      action: "confirm",
      correctionId: "correction-a",
      newClaimId: "user-claim-a",
      occurredAt: now,
    });
    const collected = collectGroundedFacts({
      memoryId: "memory-a",
      memoryStatus: "active",
      claims: [aiClaim(), correctionResult.newClaim!],
      evidence: [
        {
          id: "evidence-a",
          userId: "user-a",
          memoryId: "memory-a",
          sourceType: "ai_observation",
          validity: "valid",
        },
      ],
      corrections: [correctionResult.correction],
    });
    expect(collected.facts).toHaveLength(1);
    expect(collected.facts[0]?.truthLayer).toBe("user_confirmed");
    expect(collected.facts[0]?.provenance).toEqual({
      kind: "user_correction",
      correctionId: "correction-a",
    });
  });

  it("excludes deleted memories and unsupported/disputed claims", () => {
    for (const status of ["deleted", "deleting", "disputed"] as const) {
      const result = collectGroundedFacts({
        memoryId: "memory-a",
        memoryStatus: status,
        claims: [aiClaim()],
        evidence: [
          {
            id: "evidence-a",
            userId: "user-a",
            memoryId: "memory-a",
            sourceType: "ai_observation",
            validity: "valid",
          },
        ],
        corrections: [],
      });
      expect(result.facts).toEqual([]);
    }
  });

  it("does not use low-confidence inference in a normal factual answer", () => {
    const result = collectGroundedFacts({
      memoryId: "memory-a",
      memoryStatus: "active",
      claims: [aiClaim({ confidenceBand: "low" })],
      evidence: [
        {
          id: "evidence-a",
          userId: "user-a",
          memoryId: "memory-a",
          sourceType: "ai_observation",
          validity: "valid",
        },
      ],
      corrections: [],
    });
    expect(result.facts).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("claim_unsupported");
  });

  it("rejects answer segments that cite an ineligible claim", () => {
    expect(() =>
      validateGroundedAnswerOutput(
        {
          mode: "answer",
          segments: [{ text: "根拠のない回答", claimIds: ["invented"] }],
          unknownReason: null,
          clarificationQuestion: null,
        },
        [],
      ),
    ).toThrow(/ineligible claim/u);
  });
});

describe("candidate ambiguity gate", () => {
  it("returns two candidates rather than inventing a decisive winner", () => {
    const decision = selectSearchCandidates([
      {
        memoryId: "one",
        status: "active",
        structuredScore: 0.7,
        rerankScore: 0.72,
        matchReasons: ["時期"],
      },
      {
        memoryId: "two",
        status: "active",
        structuredScore: 0.69,
        rerankScore: 0.7,
        matchReasons: ["場所"],
      },
    ]);
    expect(decision.kind).toBe("ambiguous");
    if (decision.kind === "ambiguous")
      expect(decision.alternatives).toHaveLength(2);
  });

  it("never returns deleted candidates", () => {
    expect(
      selectSearchCandidates([
        {
          memoryId: "deleted",
          status: "deleted",
          structuredScore: 1,
          rerankScore: 1,
          matchReasons: ["一致"],
        },
      ]).kind,
    ).toBe("unknown");
  });
});
