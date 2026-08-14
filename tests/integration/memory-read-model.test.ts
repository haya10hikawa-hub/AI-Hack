import { describe, expect, it, vi } from "vitest";

import {
  getMemoryDetail,
  getMemoryThread,
} from "@/src/server/services/memories";

const memoryA = "11111111-1111-4111-8111-111111111111";
const memoryB = "22222222-2222-4222-8222-222222222222";
const sequenceA = "33333333-3333-4333-8333-333333333333";
const sequenceB = "44444444-4444-4444-8444-444444444444";
const assetA = "55555555-5555-4555-8555-555555555555";
const assetB = "66666666-6666-4666-8666-666666666666";

function builder(data: unknown) {
  const result = { data, error: null };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
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
  for (const method of [
    "select",
    "eq",
    "in",
    "or",
    "order",
    "limit",
  ] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

function client(finalRepresentatives: unknown[]) {
  const tables: Record<string, unknown> = {
    memories: [
      memoryRow(memoryA, sequenceA, "現在のMemory", "2026-04-02T09:00:00Z"),
      memoryRow(memoryB, sequenceB, "前のMemory", "2026-04-01T09:00:00Z"),
    ],
    claims: [],
    memory_gaps: [],
    sequence_assets: [
      {
        sequence_id: sequenceA,
        is_representative: true,
        asset: {
          id: assetA,
          derivative_storage_key: "fallback-a.webp",
          analysis_status: "complete",
        },
      },
      {
        sequence_id: sequenceB,
        is_representative: true,
        asset: {
          id: assetB,
          derivative_storage_key: "fallback-b.webp",
          analysis_status: "complete",
        },
      },
    ],
    evidence: [],
    memory_representatives: finalRepresentatives,
    memory_relations: [
      {
        source_memory_id: memoryB,
        target_memory_id: memoryA,
        relation_type: "same_place",
        origin: "deterministic",
        confirmation_status: "unconfirmed",
      },
    ],
  };
  return {
    from: vi.fn((table: string) => builder(tables[table] ?? [])),
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: vi.fn(async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
          error: null,
        })),
      })),
    },
  };
}

describe("Memory read model", () => {
  it("uses the final identity image and persisted relation", async () => {
    const database = client([
      {
        memory_id: memoryA,
        asset_id: assetA,
        role: "identity",
        asset: {
          id: assetA,
          derivative_storage_key: "identity-a.webp",
          analysis_status: "complete",
        },
      },
    ]);
    const result = await getMemoryThread(database as never, "user-a");
    const current = result.memories.find(({ id }) => id === memoryA)!;
    expect(current.representativeImageUrl).toBe("signed:identity-a.webp");
    expect(current.relationLabel).toBe("「前のMemory」と同じ場所");
    expect(current.relationState).toBe("confirmed");
  });

  it("falls back to the deterministic analysis candidate", async () => {
    const result = await getMemoryThread(client([]) as never, "user-a");
    expect(
      result.memories.find(({ id }) => id === memoryA)?.representativeImageUrl,
    ).toBe("signed:fallback-a.webp");
  });

  it("returns all three semantic roles and a bounded Connected Moment", async () => {
    const current = memoryRow(
      memoryA,
      sequenceA,
      "現在のMemory",
      "2026-04-02T09:00:00Z",
    );
    const related = memoryRow(
      memoryB,
      sequenceB,
      "前のMemory",
      "2026-04-01T09:00:00Z",
    );
    const currentRepresentatives = [
      representative(memoryA, assetA, "identity", "identity.webp"),
      representative(
        memoryA,
        "77777777-7777-4777-8777-777777777777",
        "key_moment",
        "key.webp",
      ),
      representative(
        memoryA,
        "88888888-8888-4888-8888-888888888888",
        "complement",
        "complement.webp",
      ),
    ];
    const relation = {
      source_memory_id: memoryB,
      target_memory_id: memoryA,
      relation_type: "before",
      origin: "deterministic",
      confirmation_status: "unconfirmed",
    };
    const queues: Record<string, unknown[]> = {
      memories: [current, [related], [current, related]],
      claims: [[], []],
      evidence: [[], []],
      memory_representatives: [
        currentRepresentatives,
        [representative(memoryB, assetB, "identity", "related.webp")],
        [
          ...currentRepresentatives,
          representative(memoryB, assetB, "identity", "related.webp"),
        ],
      ],
      memory_relations: [[relation], [relation], [relation]],
      memory_gaps: [[]],
      sequence_assets: [[]],
    };
    const database = queuedClient(queues);
    const result = await getMemoryDetail(database as never, "user-a", memoryA);
    expect(result?.representatives).toEqual({
      identity: expect.objectContaining({ imageUrl: "signed:identity.webp" }),
      keyMoment: expect.objectContaining({ imageUrl: "signed:key.webp" }),
      complement: expect.objectContaining({
        imageUrl: "signed:complement.webp",
      }),
    });
    expect(result?.relatedMemories).toEqual([
      expect.objectContaining({
        memoryId: memoryB,
        relationType: "before",
        representativeImageUrl: "signed:related.webp",
      }),
    ]);
  });
});

function representative(
  memoryId: string,
  assetId: string,
  role: "identity" | "key_moment" | "complement",
  path: string,
) {
  return {
    memory_id: memoryId,
    asset_id: assetId,
    role,
    asset: {
      id: assetId,
      derivative_storage_key: path,
      analysis_status: "complete",
    },
  };
}

function queuedClient(queues: Record<string, unknown[]>) {
  return {
    from: vi.fn((table: string) => builder(queues[table]?.shift() ?? [])),
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: vi.fn(async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
          error: null,
        })),
      })),
    },
  };
}

function memoryRow(
  id: string,
  sequenceId: string,
  title: string,
  startedAt: string,
) {
  return {
    id,
    event_id: id.replace(/^./u, "7"),
    title,
    summary: null,
    status: "active",
    importance_band: "medium",
    created_at: startedAt,
    updated_at: startedAt,
    event: {
      id: id.replace(/^./u, "7"),
      sequence_id: sequenceId,
      started_at: startedAt,
      ended_at: startedAt,
      coarse_place: "神山",
    },
  };
}
