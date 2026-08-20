import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAIProviderFromEnv: vi.fn(),
  persistAIRun: vi.fn(),
  toAssetSemanticRepresentations: vi.fn(),
}));

vi.mock("@/src/server/ai", () => ({
  SupabaseAICostLedger: class SupabaseAICostLedger {},
  SupabaseRateLimitStore: class SupabaseRateLimitStore {},
  createAIProviderFromEnv: mocks.createAIProviderFromEnv,
  persistAIRun: mocks.persistAIRun,
  toAssetSemanticRepresentations: mocks.toAssetSemanticRepresentations,
}));

import { analyzePersistedSequence } from "@/src/server/services/analysis-pipeline";

const run = {
  purpose: "event_claims",
  provider: "test",
  model: "test-model",
  promptVersion: "test",
  schemaVersion: "test",
  inputAssets: 0,
  promptTokens: 1,
  completionTokens: 1,
  estimatedCostUsd: 0,
  latencyMs: 1,
  retryCount: 0,
  status: "success",
} as const;

function query(data: unknown, singleData = data) {
  const result = { data, error: null };
  const builder = {
    select: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: singleData, error: null }),
    then: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  builder.select.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.upsert.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function database() {
  const contextRows = [
    ["time", "known", 3],
    ["location", "unknown", 2],
    ["activity", "missing", 3],
    ["purpose", "missing", 3],
    ["people", "unknown", 1],
    ["result", "unknown", 1],
    ["meaning", "not_applicable", 1],
  ].map(([dimension, status, importance_weight]) => ({
    dimension,
    status,
    importance_weight,
    active_claim_id: null,
  }));
  return {
    from: vi.fn((table: string) => {
      if (table === "events") {
        return query([], { id: "event-1" });
      }
      if (table === "memories") {
        return query([], {
          importance_band: "low",
          summary: "保存済みの要約",
        });
      }
      if (table === "evidence") {
        return query([
          {
            id: "evidence-1",
            field: "media_count",
            value_json: { count: 1 },
            source_type: "system",
          },
        ]);
      }
      if (table === "claims") return query([]);
      if (table === "memory_context_dimensions") return query(contextRows);
      if (table === "memory_gaps") return query([]);
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(),
  };
}

const representative = {
  id: "asset-1",
  capturedAt: null,
  coarsePlace: null,
  derivative: Buffer.from("test"),
  derivativeWidth: 10,
  derivativeHeight: 10,
};

describe("analysis pipeline checkpoints", () => {
  const analyzeSequence = vi.fn();
  const generateEventClaims = vi.fn();
  const detectMemoryGap = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistAIRun.mockResolvedValue("run-1");
    mocks.toAssetSemanticRepresentations.mockReturnValue([]);
    mocks.createAIProviderFromEnv.mockReturnValue({
      analyzeSequence,
      generateEventClaims,
      detectMemoryGap,
    });
    analyzeSequence.mockResolvedValue({
      run: { ...run, purpose: "sequence_analysis" },
      data: {
        titleCandidate: "再構成タイトル",
        summaryCandidate: "再構成要約",
        observations: [],
      },
    });
    generateEventClaims.mockResolvedValue({
      run,
      data: { claims: [] },
    });
  });

  it("resumes a gap checkpoint without repeating Vision or claim generation", async () => {
    const onStage = vi.fn().mockResolvedValue(undefined);
    await analyzePersistedSequence({
      userId: "user-1",
      requestId: "request-1",
      sequenceId: "sequence-1",
      memoryId: "memory-1",
      representativeAssets: [representative],
      database: database() as never,
      resumeFrom: "gap",
      onStage,
    });

    expect(analyzeSequence).not.toHaveBeenCalled();
    expect(generateEventClaims).not.toHaveBeenCalled();
    expect(detectMemoryGap).not.toHaveBeenCalled();
    expect(onStage).toHaveBeenCalledWith("gap");
  });

  it("resumes a claims checkpoint without repeating Vision", async () => {
    await analyzePersistedSequence({
      userId: "user-1",
      requestId: "request-1",
      sequenceId: "sequence-1",
      memoryId: "memory-1",
      representativeAssets: [representative],
      database: database() as never,
      resumeFrom: "claims",
    });

    expect(analyzeSequence).not.toHaveBeenCalled();
    expect(generateEventClaims).toHaveBeenCalledOnce();
  });

  it("runs Vision for a fresh analysis checkpoint", async () => {
    await analyzePersistedSequence({
      userId: "user-1",
      requestId: "request-1",
      sequenceId: "sequence-1",
      memoryId: "memory-1",
      representativeAssets: [representative],
      database: database() as never,
      resumeFrom: "analysis",
    });

    expect(analyzeSequence).toHaveBeenCalledOnce();
    expect(generateEventClaims).toHaveBeenCalledOnce();
  });

  it("hands a completed Vision stage back before claim generation", async () => {
    const progress = await analyzePersistedSequence({
      userId: "user-1",
      requestId: "request-1",
      sequenceId: "sequence-1",
      memoryId: "memory-1",
      representativeAssets: [representative],
      database: database() as never,
      resumeFrom: "analysis",
      stopAfterStage: true,
    });

    expect(progress).toEqual({ complete: false, nextStage: "claims" });
    expect(analyzeSequence).toHaveBeenCalledOnce();
    expect(generateEventClaims).not.toHaveBeenCalled();
  });

  it("hands a completed claims stage back before gap detection", async () => {
    const progress = await analyzePersistedSequence({
      userId: "user-1",
      requestId: "request-1",
      sequenceId: "sequence-1",
      memoryId: "memory-1",
      representativeAssets: [],
      database: database() as never,
      resumeFrom: "claims",
      stopAfterStage: true,
    });

    expect(progress).toEqual({ complete: false, nextStage: "gap" });
    expect(analyzeSequence).not.toHaveBeenCalled();
    expect(generateEventClaims).toHaveBeenCalledOnce();
    expect(detectMemoryGap).not.toHaveBeenCalled();
  });
});
