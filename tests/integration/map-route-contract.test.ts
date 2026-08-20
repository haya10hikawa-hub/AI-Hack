import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BearerTokenError } from "@/src/server/http/security";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  resolveRequestAuth: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  getMemoryMap: vi.fn(),
}));

vi.mock("@/src/server/supabase/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
  resolveRequestAuth: mocks.resolveRequestAuth,
}));
vi.mock("@/src/server/supabase/client", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock("@/src/server/services/memory-map", () => ({
  getMemoryMap: mocks.getMemoryMap,
}));

import { DELETE, GET, POST } from "@/app/api/map/route";

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
    mocks.resolveRequestAuth.mockResolvedValue({
      user: { id: userId },
      supabase: { kind: "bearer-client" },
      mode: "bearer",
    });
  });

  it("reads through request auth so Bearer callers keep their RLS client", async () => {
    mocks.getMemoryMap.mockResolvedValue({ enabled: true, cells: [] });
    const request = new NextRequest("http://localhost/api/map", {
      headers: { authorization: "Bearer valid-test-token-value" },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(mocks.resolveRequestAuth).toHaveBeenCalledWith(request);
    expect(mocks.getMemoryMap).toHaveBeenCalledWith(
      { kind: "bearer-client" },
      userId,
    );
  });

  it("returns AUTH_TOKEN_INVALID instead of falling back for a rejected Bearer", async () => {
    mocks.resolveRequestAuth.mockRejectedValue(new BearerTokenError());
    const response = await GET(
      new NextRequest("http://localhost/api/map", {
        headers: { authorization: "Bearer rejected-test-token" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_TOKEN_INVALID" },
    });
    expect(mocks.getMemoryMap).not.toHaveBeenCalled();
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
