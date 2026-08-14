import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  getMemoryMap: vi.fn(),
}));

vi.mock("@/src/server/supabase/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}));
vi.mock("@/src/server/supabase/client", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock("@/src/server/services/memory-map", () => ({
  getMemoryMap: mocks.getMemoryMap,
}));

import { DELETE, POST } from "@/app/api/map/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cellId = "8a2e6e82175ffff";

function request(method: "POST" | "DELETE", body?: unknown) {
  return new NextRequest("http://localhost/api/map", {
    method,
    headers: {
      origin: "http://localhost",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function preferenceQuery(enabled = true) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { memory_map_enabled: enabled },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("Memory Map route privacy contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: userId },
      supabase: {},
    });
  });

  it("accepts only a valid H3 cell and derives ownership from the session", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "cell-row-id", error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(preferenceQuery()),
      rpc,
    });

    const response = await POST(request("POST", { cellId }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("reveal_memory_map_cell", {
      p_user_id: userId,
      p_cell_id: cellId,
    });
  });

  it("rejects exact coordinates and never reaches the map mutation", async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(preferenceQuery()),
      rpc,
    });

    const response = await POST(
      request("POST", { cellId, latitude: 35, longitude: 135 }),
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("clears only the authenticated owner's map rows", async () => {
    const deletion = {
      delete: vi.fn(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    deletion.delete.mockReturnValue(deletion);
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(deletion),
    });

    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(deletion.eq).toHaveBeenCalledWith("user_id", userId);
  });
});
