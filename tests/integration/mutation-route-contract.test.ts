import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
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

import { POST as confirmGap } from "@/app/api/gaps/[id]/confirm/route";
import { GET as listGaps } from "@/app/api/gaps/route";
import { POST as deleteMemory } from "@/app/api/memories/[id]/delete/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const gapId = "11111111-1111-4111-8111-111111111111";
const memoryId = "22222222-2222-4222-8222-222222222222";
const createdClaimId = "33333333-3333-4333-8333-333333333333";

function jsonPost(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function selectedRow<T>(data: T) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function singleRow<T>(data: T) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function filteredRows(data: unknown[]) {
  const result = { data, error: null };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    then: <TResult1 = typeof result, TResult2 = never>(
      onfulfilled?:
        | ((value: typeof result) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}

function selectedRows(data: unknown[]) {
  const result = { data, error: null };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: <TResult1 = typeof result, TResult2 = never>(
      onfulfilled?:
        | ((value: typeof result) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

describe("gap confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase: {},
    });
  });

  it("uses the exact atomic RPC and derives a stable idempotency key", async () => {
    const gapQuery = selectedRow({
      id: gapId,
      memory_id: memoryId,
      dimension: "purpose",
      status: "ready_to_ask",
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ created_claim_id: createdClaimId }],
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(gapQuery),
      rpc,
    });

    const first = await confirmGap(
      jsonPost(`/api/gaps/${gapId}/confirm`, { decision: "confirm" }),
      { params: Promise.resolve({ id: gapId }) },
    );
    const second = await confirmGap(
      jsonPost(`/api/gaps/${gapId}/confirm`, { decision: "confirm" }),
      { params: Promise.resolve({ id: gapId }) },
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      data: { saved: true, createdClaimId },
    });
    expect(second.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe("apply_memory_gap_correction");
      expect(call[1]).toMatchObject({
        p_user_id: userId,
        p_gap_id: gapId,
        p_action: "confirm",
        p_value_json: null,
        p_field: "purpose",
      });
      expect(call[1].p_idempotency_key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
    expect(rpc.mock.calls[0]![1].p_idempotency_key).toBe(
      rpc.mock.calls[1]![1].p_idempotency_key,
    );
  });

  it("shows the persisted candidate value even when options have no label", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue(
        selectedRows([
          {
            id: gapId,
            memory_id: memoryId,
            question: "これはFTCの練習でしたか？",
            options_json: [],
            candidate_value_json: { purpose: "FTCの練習" },
            reason_json: { evidenceSummary: "ロボットの写真があります。" },
            status: "ready_to_ask",
            memory: { title: "神山でのロボット制作" },
          },
        ]),
      ),
    };
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase,
    });

    const response = await listGaps(
      new NextRequest("http://localhost/api/gaps"),
    );
    const envelope = await response.json();

    expect(response.status).toBe(200);
    expect(envelope.data.gaps).toHaveLength(1);
    expect(envelope.data.gaps[0]).toMatchObject({
      id: gapId,
      candidateLabel: "FTCの練習",
    });
  });
});

describe("memory deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase: {},
    });
  });

  it.each([
    ["already absent", null],
    ["already deleted", { id: memoryId, status: "deleted", event_id: null }],
  ])("treats an %s memory as a successful replay", async (_label, row) => {
    const memoryQuery = selectedRow(row);
    const rpc = vi.fn();
    const remove = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(memoryQuery),
      rpc,
      storage: { from: vi.fn().mockReturnValue({ remove }) },
    });

    const response = await deleteMemory(
      jsonPost(`/api/memories/${memoryId}/delete`, {}),
      { params: Promise.resolve({ id: memoryId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { deleted: true, idempotent: true },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["active", true],
    ["deleting", false],
  ])(
    "finishes an %s deletion and only requests the transition when needed",
    async (status, shouldRequest) => {
      const owned = selectedRow({
        id: memoryId,
        status,
        event_id: "44444444-4444-4444-8444-444444444444",
      });
      const event = singleRow({
        sequence_id: "55555555-5555-4555-8555-555555555555",
      });
      const memberships = filteredRows([
        { asset_id: "66666666-6666-4666-8666-666666666666" },
      ]);
      const assets = filteredRows([
        {
          storage_key: `${userId}/assets/original.jpg`,
          derivative_storage_key: `${userId}/assets/derivative.webp`,
        },
      ]);
      const from = vi.fn((table: string) => {
        if (table === "memories") return owned;
        if (table === "events") return event;
        if (table === "sequence_assets") return memberships;
        if (table === "media_assets") return assets;
        throw new Error(`Unexpected table: ${table}`);
      });
      const rpc = vi.fn((name: string) => {
        if (name === "request_memory_deletion") {
          return Promise.resolve({ data: true, error: null });
        }
        if (name === "finalize_memory_deletion") {
          return Promise.resolve({ data: true, error: null });
        }
        throw new Error(`Unexpected RPC: ${name}`);
      });
      const remove = vi
        .fn()
        .mockResolvedValue({ data: [{ name: "deleted" }], error: null });
      mocks.createSupabaseAdminClient.mockReturnValue({
        from,
        rpc,
        storage: { from: vi.fn().mockReturnValue({ remove }) },
      });

      const response = await deleteMemory(
        jsonPost(`/api/memories/${memoryId}/delete`, {}),
        { params: Promise.resolve({ id: memoryId }) },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { deleted: true },
      });
      expect(remove).toHaveBeenCalledWith([
        `${userId}/assets/original.jpg`,
        `${userId}/assets/derivative.webp`,
      ]);
      expect(rpc).toHaveBeenCalledWith("finalize_memory_deletion", {
        p_user_id: userId,
        p_memory_id: memoryId,
      });
      expect(
        rpc.mock.calls.some(([name]) => name === "request_memory_deletion"),
      ).toBe(shouldRequest);
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
        rpc.mock.invocationCallOrder.at(-1)!,
      );
    },
  );
});
