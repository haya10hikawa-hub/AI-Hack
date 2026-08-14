import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  processAnalysisJobs: vi.fn(),
}));

vi.mock("@/src/server/supabase/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}));

vi.mock("@/src/server/supabase/client", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@/src/server/services/analysis-jobs", () => ({
  processAnalysisJobs: mocks.processAnalysisJobs,
}));

import { POST } from "@/app/api/analysis/retry/route";

function retryableQuery(
  rows: Array<{ sequence_id: string; memory_id: string }>,
) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: { data: typeof rows; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/analysis/retry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("analysis retry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111" },
    });
    mocks.processAnalysisJobs.mockResolvedValue({
      claimed: 1,
      completed: 1,
      retryScheduled: 0,
      dead: 0,
    });
  });

  it("requeues only the authenticated owner's failed Memory and starts work", async () => {
    const query = retryableQuery([
      {
        sequence_id: "22222222-2222-4222-8222-222222222222",
        memory_id: "33333333-3333-4333-8333-333333333333",
      },
    ]);
    const rpc = vi.fn().mockResolvedValue({
      data: "44444444-4444-4444-8444-444444444444",
      error: null,
    });
    const database = { from: vi.fn().mockReturnValue(query), rpc };
    mocks.createSupabaseAdminClient.mockReturnValue(database);

    const response = await POST(
      request({ memoryId: "33333333-3333-4333-8333-333333333333" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.retryRequested).toBe(1);
    expect(query.eq).toHaveBeenCalledWith(
      "user_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(query.eq).toHaveBeenCalledWith(
      "memory_id",
      "33333333-3333-4333-8333-333333333333",
    );
    expect(query.in).toHaveBeenCalledWith("status", ["dead", "retry_wait"]);
    expect(rpc).toHaveBeenCalledWith("enqueue_sequence_analysis_job", {
      p_user_id: "11111111-1111-4111-8111-111111111111",
      p_sequence_id: "22222222-2222-4222-8222-222222222222",
      p_memory_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(mocks.processAnalysisJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        database,
        userId: "11111111-1111-4111-8111-111111111111",
        maxJobs: 1,
      }),
    );
  });

  it("honestly reports when there is no failed job while still resuming queued work", async () => {
    const query = retryableQuery([]);
    const database = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn(),
    };
    mocks.createSupabaseAdminClient.mockReturnValue(database);

    const response = await POST(request({}));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.retryRequested).toBe(0);
    expect(database.rpc).not.toHaveBeenCalled();
    expect(mocks.processAnalysisJobs).toHaveBeenCalledOnce();
  });
});
