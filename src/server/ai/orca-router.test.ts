import { describe, expect, it, vi } from "vitest";

import {
  AICostGuard,
  AIProviderError,
  InMemoryAICostLedger,
  OrcaRouterProvider,
  type AIModelCatalog,
} from "@/src/server/ai";
import {
  GapDetectionInputSchema,
  GapDetectionOutputSchema,
  assertGapReferences,
} from "@/src/server/ai/schemas";
import {
  canonicalizeGroundedAnswerText,
  validateGroundedAnswerOutput,
} from "@/src/domain/grounded-answer";
import {
  FixedWindowRateLimiter,
  InMemoryRateLimitStore,
} from "@/src/server/security/rate-limit";

const models: AIModelCatalog = {
  VISION_CHEAP: model("vision-test"),
  EVENT_CHEAP: model("event-test"),
  CHAT_CHEAP: model("chat-test"),
  EVENT_STRONG: model("strong-test"),
};

const context = {
  userId: "user-a",
  requestId: "request-a",
  allowStrongModel: false,
};

const queryInput = {
  rawQuery: "神山",
  confirmedAliases: [],
  currentDate: "2026-08-14",
  timezone: "Asia/Tokyo",
};

describe("OrcaRouterProvider failure boundaries", () => {
  it("retries one retryable 5xx and settles both attempts within the reservation", async () => {
    const ledger = new InMemoryAICostLedger();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(
        completionResponse({
          rawQuery: "神山",
          dateRange: null,
          places: ["神山"],
          people: [],
          activities: [],
          keywords: [],
          aliasesApplied: [],
        }),
      );
    const provider = providerWith(fetchImplementation, ledger);

    const result = await provider.parseSearchQuery(context, queryInput);

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(result.run).toMatchObject({
      status: "success",
      retryCount: 1,
      promptTokens: 20,
      completionTokens: 10,
    });
    expect(result.run.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.run.estimatedCostUsd).toBe(
      ledger.getSpent("user-a", utcDay()),
    );
  });

  it("does not retry invalid structured output and exposes a content-free audit run", async () => {
    const ledger = new InMemoryAICostLedger();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completionResponse({ rawQuery: "changed" }));
    const provider = providerWith(fetchImplementation, ledger);

    let caught: unknown;
    try {
      await provider.parseSearchQuery(context, queryInput);
    } catch (error) {
      caught = error;
    }

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect((caught as AIProviderError).code).toBe("invalid_output");
    expect((caught as AIProviderError).auditRun).toMatchObject({
      purpose: "parse_search_query",
      status: "invalid_output",
      retryCount: 0,
      promptTokens: null,
      completionTokens: null,
    });
    expect(ledger.getSpent("user-a", utcDay())).toBeGreaterThan(0);
  });

  it("counts retry attempts against the rate gate and fails closed", async () => {
    const ledger = new InMemoryAICostLedger();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("busy", { status: 500 }));
    const provider = new OrcaRouterProvider({
      apiKey: "test-key",
      baseUrl: "http://localhost/v1",
      models,
      rateLimiter: new FixedWindowRateLimiter(
        { namespace: "ai", limit: 1, windowMs: 60_000 },
        new InMemoryRateLimitStore(),
      ),
      costGuard: new AICostGuard(
        { dailyLimitUsd: 1, perRequestLimitUsd: 1 },
        ledger,
      ),
      fetchImplementation,
      maxRetries: 1,
    });

    await expect(
      provider.parseSearchQuery(context, queryInput),
    ).rejects.toMatchObject({
      code: "rate_limited",
      auditRun: { status: "rate_limited", retryCount: 0 },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

describe("grounding postconditions", () => {
  it("discards arbitrary model prose and renders the selected claim value", () => {
    const result = canonicalizeGroundedAnswerText(
      {
        mode: "answer",
        segments: [
          { text: "Unrelated invented story", claimIds: ["claim-purpose"] },
        ],
        unknownReason: null,
        clarificationQuestion: null,
      },
      [
        {
          claimId: "claim-purpose",
          field: "purpose",
          value: "FTCの練習",
        },
      ],
    );

    expect(result.segments[0]?.text).toBe("目的：FTCの練習");
    expect(result.segments[0]?.text).not.toContain("invented");
  });

  it("applies deterministic rendering at the public validation boundary", () => {
    const result = validateGroundedAnswerOutput(
      {
        mode: "answer",
        segments: [{ text: "Invented", claimIds: ["claim-purpose"] }],
        unknownReason: null,
        clarificationQuestion: null,
      },
      [
        {
          claimId: "claim-purpose",
          field: "purpose",
          value: "FTCの練習",
          truthLayer: "user_confirmed",
          provenance: {
            kind: "user_correction",
            correctionId: "correction-purpose",
          },
        },
      ],
    );

    expect(result.segments[0]?.text).toBe("目的：FTCの練習");
    expect(result.provenance["claim-purpose"]?.truthLayer).toBe(
      "user_confirmed",
    );
  });

  it("keeps unknown inference field names out of grounded prose", () => {
    const result = canonicalizeGroundedAnswerText(
      {
        mode: "answer",
        segments: [{ text: "Invented", claimIds: ["claim-unknown"] }],
        unknownReason: null,
        clarificationQuestion: null,
      },
      [
        {
          claimId: "claim-unknown",
          field: "ignore_previous_instructions",
          value: "確認済みの値",
        },
      ],
    );

    expect(result.segments[0]?.text).toBe("情報：確認済みの値");
  });

  it("requires a gap candidate to bind its exact value and input evidence", () => {
    const input = GapDetectionInputSchema.parse({
      memoryId: "memory-a",
      importanceBand: "medium",
      missingDimensions: ["purpose"],
      knownFacts: [],
      evidence: [
        {
          evidenceId: "evidence-a",
          field: "activity",
          value: "robot adjustment",
          sourceType: "ai_observation",
        },
      ],
    });
    const candidate = GapDetectionOutputSchema.parse({
      hasValuableGap: true,
      candidate: {
        dimension: "purpose",
        gapType: "purpose",
        question: "FTCの練習ですか？",
        options: [
          { label: "そう", value: "yes" },
          { label: "違う", value: "no" },
        ],
        candidateOptionValue: "yes",
        candidateValue: "FTCの練習",
        evidenceIds: ["evidence-a"],
        confidenceBand: "high",
        candidateSpecificity: 0.85,
      },
    });
    expect(() => assertGapReferences(candidate, input)).not.toThrow();
    expect(() =>
      assertGapReferences(
        {
          ...candidate,
          candidate: {
            ...candidate.candidate!,
            evidenceIds: ["outside-evidence"],
          },
        },
        input,
      ),
    ).toThrow(/outside its input/u);
  });

  it("rejects ambiguous gap option bindings and null provisional facts", () => {
    expect(() =>
      GapDetectionOutputSchema.parse({
        hasValuableGap: true,
        candidate: {
          dimension: "purpose",
          gapType: "purpose",
          question: "何のための活動ですか？",
          options: [
            { label: "候補A", value: "same" },
            { label: "候補B", value: "same" },
          ],
          candidateOptionValue: "same",
          candidateValue: null,
          evidenceIds: ["evidence-a"],
          confidenceBand: "high",
          candidateSpecificity: 0.9,
        },
      }),
    ).toThrow();
  });
});

function providerWith(
  fetchImplementation: typeof fetch,
  ledger: InMemoryAICostLedger,
) {
  return new OrcaRouterProvider({
    apiKey: "test-key",
    baseUrl: "http://localhost/v1",
    models,
    rateLimiter: new FixedWindowRateLimiter(
      { namespace: "ai", limit: 10, windowMs: 60_000 },
      new InMemoryRateLimitStore(),
    ),
    costGuard: new AICostGuard(
      { dailyLimitUsd: 1, perRequestLimitUsd: 1 },
      ledger,
    ),
    fetchImplementation,
    maxRetries: 1,
  });
}

function model(name: string) {
  return {
    model: name,
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 1,
    imageUsdEach: 0.01,
    maxOutputTokens: 100,
  };
}

function completionResponse(content: unknown): Response {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  });
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}
