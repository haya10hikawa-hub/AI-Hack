import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  createAIProviderFromEnv: vi.fn(),
  persistAIRun: vi.fn(),
  persistAIProviderFailure: vi.fn(),
  getMemoryThread: vi.fn(),
}));

vi.mock("@/src/server/supabase/auth", () => {
  class AuthenticationError extends Error {
    constructor(message = "Authentication is required.") {
      super(message);
      this.name = "AuthenticationError";
    }
  }
  return {
    AuthenticationError,
    requireAuthenticatedUser: mocks.requireAuthenticatedUser,
  };
});

vi.mock("@/src/server/supabase/client", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/src/server/ai", () => {
  class NoopGate {
    constructor() {}
  }
  return {
    SupabaseAICostLedger: NoopGate,
    SupabaseRateLimitStore: NoopGate,
    createAIProviderFromEnv: mocks.createAIProviderFromEnv,
    persistAIRun: mocks.persistAIRun,
    persistAIProviderFailure: mocks.persistAIProviderFailure,
  };
});

vi.mock("@/src/server/services/memories", () => {
  class RepositoryError extends Error {
    constructor(readonly operation: string) {
      super(`Repository operation failed: ${operation}`);
      this.name = "RepositoryError";
    }
  }
  return {
    RepositoryError,
    getMemoryThread: mocks.getMemoryThread,
  };
});

import { POST as searchMemories } from "@/app/api/search/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memoryId = "11111111-1111-4111-8111-111111111111";
const secondMemoryId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const secondEventId = "44444444-4444-4444-8444-444444444444";
const claimId = "55555555-5555-4555-8555-555555555555";
const correctionId = "66666666-6666-4666-8666-666666666666";
const now = "2026-08-14T09:00:00.000Z";

const SearchResponseSchema = z
  .object({
    interpretation: z
      .object({
        time: z.string().nullable(),
        place: z.string().nullable(),
        people: z.array(z.string()),
        activities: z.array(z.string()),
        keywords: z.array(z.string()),
      })
      .strict(),
    answer: z.string().nullable(),
    answerState: z.enum(["unknown", "clarification", "grounded"]),
    candidates: z.array(z.unknown()),
    sources: z.array(
      z
        .object({
          claimId: z.string(),
          label: z.string(),
          kind: z.enum(["evidence", "user_correction"]),
        })
        .strict(),
    ),
    clarification: z.string().nullable(),
    partial: z.boolean().optional(),
    partialMessage: z.string().nullable().optional(),
    feedbackEnabled: z.boolean().optional(),
  })
  .strict();

type Scenario = "unknown" | "ambiguous" | "grounded";
let scenario: Scenario;

function resultBuilder(data: unknown) {
  const result = { data, error: null };
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: <TResult1 = typeof result, TResult2 = never>(
      onfulfilled?:
        | ((value: typeof result) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function memoryRow(input: {
  id: string;
  eventId: string;
  title: string;
  claim?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    title: input.title,
    summary: "Memory summary",
    status: "active",
    event_id: input.eventId,
    event: {
      id: input.eventId,
      started_at: "2026-04-12T09:00:00.000Z",
      coarse_place: "神山",
    },
    claims: input.claim === undefined ? [] : [input.claim],
  };
}

function responseMemory(id: string, title: string) {
  return {
    id,
    title,
    capturedAt: "2026-04-12T09:00:00.000Z",
    placeLabel: "神山",
    photoCount: 1,
    representativeImageUrl: null,
    representativeImageAlt: null,
    state: "confirmed",
    processingState: "ready",
    summary: "Memory summary",
    relationLabel: null,
    relationState: null,
    hasOpenGap: false,
    evidenceCount: 1,
  };
}

function run() {
  return {
    purpose: "search_parse",
    provider: "test",
    model: "test-model",
    routeClass: "standard",
    schemaVersion: "test-v1",
    promptVersion: "test-v1",
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    estimatedCostUsd: 0,
    retryCount: 0,
    status: "succeeded",
    errorCode: null,
    providerRequestId: null,
  };
}

function parsedQuery(keywords: string[]) {
  return {
    rawQuery: keywords.join(" ") || "missing memory",
    dateRange: null,
    places: [],
    people: [],
    activities: [],
    keywords,
    aliasesApplied: [],
  };
}

function jsonRequest(query: string): NextRequest {
  return new NextRequest("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      timezone: "Asia/Tokyo",
      currentDate: "2026-08-14",
    }),
  });
}

describe("search route response contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistAIRun.mockResolvedValue(
      "88888888-8888-4888-8888-888888888888",
    );
    mocks.persistAIProviderFailure.mockResolvedValue(undefined);
    mocks.createSupabaseAdminClient.mockReturnValue({});
    mocks.getMemoryThread.mockImplementation(async () => ({
      memories:
        scenario === "ambiguous"
          ? [
              responseMemory(memoryId, "FTC robot"),
              responseMemory(secondMemoryId, "FTC robot lab"),
            ]
          : [responseMemory(memoryId, "FTCの練習")],
    }));
  });

  it("returns a complete unknown shape without manufacturing an answer", async () => {
    scenario = "unknown";
    const supabase = {
      from: vi.fn((table: string) =>
        resultBuilder(table === "memories" ? [] : []),
      ),
    };
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase,
    });
    mocks.createAIProviderFromEnv.mockReturnValue({
      parseSearchQuery: vi.fn().mockResolvedValue({
        data: parsedQuery([]),
        run: run(),
      }),
    });

    const response = await searchMemories(jsonRequest("missing memory"));
    const envelope = z
      .object({ data: SearchResponseSchema })
      .strict()
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(envelope.data).toMatchObject({
      answer: null,
      answerState: "unknown",
      candidates: [],
      sources: [],
      clarification: null,
    });
  });

  it("returns a complete clarification shape for close candidates", async () => {
    scenario = "ambiguous";
    const rows = [
      memoryRow({ id: memoryId, eventId, title: "FTC robot" }),
      memoryRow({
        id: secondMemoryId,
        eventId: secondEventId,
        title: "FTC robot lab",
      }),
    ];
    const supabase = {
      from: vi.fn((table: string) =>
        resultBuilder(table === "memories" ? rows : []),
      ),
    };
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase,
    });
    mocks.createAIProviderFromEnv.mockReturnValue({
      parseSearchQuery: vi.fn().mockResolvedValue({
        data: {
          ...parsedQuery(["robot"]),
          activities: ["FTC"],
          rawQuery: "FTC robot",
        },
        run: run(),
      }),
      rerankSearchCandidates: vi.fn().mockResolvedValue({
        data: {
          ranked: [
            { memoryId, score: 0.75, matchReasons: ["内容が近い"] },
            {
              memoryId: secondMemoryId,
              score: 0.73,
              matchReasons: ["内容が近い"],
            },
          ],
        },
        run: run(),
      }),
    });

    const response = await searchMemories(jsonRequest("FTC robot"));
    const envelope = z
      .object({ data: SearchResponseSchema })
      .strict()
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(envelope.data.answerState).toBe("clarification");
    expect(envelope.data.answer).toBeNull();
    expect(envelope.data.candidates).toHaveLength(2);
    expect(envelope.data.sources).toEqual([]);
    expect(envelope.data.clarification).toMatch(/候補/u);
  });

  it("grounds a single-word match from a user-confirmed claim", async () => {
    scenario = "grounded";
    const userClaim = {
      id: claimId,
      field: "purpose",
      value_json: { value: "FTC練習" },
      origin: "user",
      confidence_band: "high",
      confirmation_status: "user_confirmed",
      status: "active",
      ai_run_id: null,
      source_correction_id: correctionId,
      created_at: now,
      updated_at: now,
      claim_evidence: [],
    };
    const rows = [
      memoryRow({
        id: memoryId,
        eventId,
        title: "名称未設定",
        claim: userClaim,
      }),
    ];
    const tableData: Record<string, unknown> = {
      memories: rows,
      evidence: [],
      user_corrections: [
        {
          id: correctionId,
          memory_id: memoryId,
          target_claim_id: "99999999-9999-4999-8999-999999999999",
          action: "confirm",
          value_json: { value: "FTC練習" },
          created_claim_id: claimId,
          idempotency_key: "single-confirmation",
          created_at: now,
        },
      ],
      memory_gaps: null,
    };
    const supabase = {
      from: vi.fn((table: string) => resultBuilder(tableData[table] ?? [])),
    };
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase,
    });
    mocks.createAIProviderFromEnv.mockReturnValue({
      parseSearchQuery: vi.fn().mockResolvedValue({
        data: parsedQuery(["FTC練習"]),
        run: run(),
      }),
      rerankSearchCandidates: vi.fn().mockResolvedValue({
        data: {
          ranked: [{ memoryId, score: 0.91, matchReasons: ["確認済みの目的"] }],
        },
        run: run(),
      }),
      generateGroundedAnswer: vi.fn().mockResolvedValue({
        data: {
          mode: "answer",
          segments: [{ text: "目的：FTC練習", claimIds: [claimId] }],
          unknownReason: null,
          clarificationQuestion: null,
        },
        run: run(),
      }),
    });

    const response = await searchMemories(jsonRequest("FTC練習"));
    const envelope = z
      .object({ data: SearchResponseSchema })
      .strict()
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(envelope.data.answerState).toBe("grounded");
    expect(envelope.data.answer).toContain("FTC練習");
    expect(envelope.data.candidates).toHaveLength(1);
    expect(envelope.data.sources).toEqual([
      {
        claimId,
        label: "purpose: FTC練習",
        kind: "user_correction",
      },
    ]);
    expect(envelope.data.clarification).toBeNull();
  });
});
