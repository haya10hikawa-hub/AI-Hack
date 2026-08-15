import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  ApiErrorSchema,
  ApiSuccessSchema,
  ConfirmationMutationResponseSchema,
  ConfirmationQueueTransportSchema,
  MemoryDetailTransportSchema,
  MemoryThreadTransportSchema,
} from "@/src/contracts/client-api-v1";

/**
 * These tests exercise the real request auth resolver. Only Supabase itself and
 * the cookie store are faked, so the cookie, preview, and bearer branches are
 * the shipped ones.
 */

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMORY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GAP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLAIM_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// Shaped like a Supabase access token so the header parser accepts it. No real
// token is ever placed in this repository.
const OWNER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.owner-access-token-fixture.signature";
const OTHER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.other-access-token-fixture.signature";
const REVOKED_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.revoked-access-token-fixture.signature";

const sessionsByToken = new Map([
  [OWNER_TOKEN, OWNER_ID],
  [OTHER_TOKEN, OTHER_ID],
]);

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  cookieSessionUserId: { current: null as string | null },
  adminCreateUser: vi.fn(),
  adminGetUserById: vi.fn(),
  bearerTokens: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
    getAll: () => [],
  }),
}));

vi.mock("@/src/server/supabase/client", () => ({
  createSupabaseServerClient: async () =>
    fakeSupabase(mocks.cookieSessionUserId.current),
  createSupabaseBearerClient: (accessToken: string) => {
    mocks.bearerTokens.push(accessToken);
    return fakeSupabase(sessionsByToken.get(accessToken) ?? null, accessToken);
  },
  createSupabaseAdminClient: () => fakeAdminSupabase(),
}));

import { POST as confirmGap } from "@/app/api/gaps/[id]/confirm/route";
import { GET as listGaps } from "@/app/api/gaps/route";
import { GET as getMemory } from "@/app/api/memories/[id]/route";
import { GET as listMemories } from "@/app/api/memories/route";

/* ------------------------------------------------------------------ *
 * Fake Supabase
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function ownedRows(): Record<string, Row[]> {
  return {
    memories: [
      {
        user_id: OWNER_ID,
        id: MEMORY_ID,
        event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        title: "神山でのロボット制作",
        summary: "ロボットを組み立てた一日。",
        status: "active",
        importance_band: "medium",
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-02T00:00:00.000Z",
        event: null,
      },
    ],
    claims: [],
    memory_gaps: [
      {
        user_id: OWNER_ID,
        id: GAP_ID,
        memory_id: MEMORY_ID,
        dimension: "purpose",
        question: "これはFTCの練習でしたか？",
        options_json: [],
        candidate_value_json: { purpose: "FTCの練習" },
        reason_json: { evidenceSummary: "ロボットの写真があります。" },
        status: "ready_to_ask",
        memory: { title: "神山でのロボット制作" },
      },
    ],
    memory_representatives: [],
    memory_relations: [],
    evidence: [],
    sequence_assets: [],
    media_assets: [],
  };
}

/**
 * Filters rows the way Row Level Security does for a session client: every
 * `user_id` predicate the route issues is applied to the fixture, so a caller
 * can only ever observe its own rows.
 */
function fakeSupabase(userId: string | null, accessToken?: string) {
  const tables = ownedRows();
  return {
    auth: {
      getUser: async (jwt?: string) => {
        const resolved =
          jwt === undefined ? userId : (sessionsByToken.get(jwt) ?? null);
        return resolved === null
          ? {
              data: { user: null },
              // Deliberately mirrors a real rejection: no token material.
              error: { message: "invalid claim: missing sub claim" },
            }
          : { data: { user: { id: resolved } }, error: null };
      },
    },
    accessToken,
    from: (table: string) => queryBuilder(tables[table] ?? []),
    storage: {
      from: () => ({
        createSignedUrls: async () => ({ data: [], error: null }),
      }),
    },
  };
}

function fakeAdminSupabase() {
  const tables = ownedRows();
  return {
    auth: {
      admin: {
        createUser: mocks.adminCreateUser,
        getUserById: mocks.adminGetUserById,
      },
    },
    from: (table: string) => queryBuilder(tables[table] ?? []),
    rpc: rpcMock,
    storage: {
      from: () => ({
        createSignedUrls: async () => ({ data: [], error: null }),
      }),
    },
  };
}

const rpcMock = vi.fn(async () => ({
  data: [{ created_claim_id: CLAIM_ID }],
  error: null,
}));

function queryBuilder(rows: Row[]) {
  let current = rows;
  const result = () => ({ data: current, error: null });
  const query: Record<string, unknown> = {
    select: () => query,
    order: () => query,
    limit: () => query,
    or: () => query,
    update: () => query,
    eq: (column: string, value: unknown) => {
      current = current.filter((row) => row[column] === value);
      return query;
    },
    in: (column: string, values: unknown[]) => {
      current = current.filter((row) => values.includes(row[column]));
      return query;
    },
    maybeSingle: async () => ({ data: current[0] ?? null, error: null }),
    single: async () => ({ data: current[0] ?? null, error: null }),
    then: <T1, T2>(
      onfulfilled?: ((value: ReturnType<typeof result>) => T1) | null,
      onrejected?: ((reason: unknown) => T2) | null,
    ) => Promise.resolve(result()).then(onfulfilled, onrejected),
  };
  return query;
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

function get(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const gapParams = { params: Promise.resolve({ id: GAP_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bearerTokens.length = 0;
  mocks.cookieSessionUserId.current = null;
  mocks.cookieGet.mockReturnValue(undefined);
});

/* ------------------------------------------------------------------ *
 * A. The browser contract is unchanged
 * ------------------------------------------------------------------ */

describe("cookie session (existing web client)", () => {
  it("reads the thread through the cookie identity without a bearer token", async () => {
    mocks.cookieSessionUserId.current = OWNER_ID;

    const response = await listMemories(get("/api/memories"));
    const envelope = ApiSuccessSchema(MemoryThreadTransportSchema).parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(envelope.data.memories.map(({ id }) => id)).toEqual([MEMORY_ID]);
    expect(mocks.bearerTokens).toEqual([]);
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });

  it("keeps a cookie mutation bound to the browser origin", async () => {
    mocks.cookieSessionUserId.current = OWNER_ID;

    const response = await confirmGap(
      post(
        `/api/gaps/${GAP_ID}/confirm`,
        { decision: "confirm" },
        {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      ),
      gapParams,
    );

    expect(response.status).toBe(403);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe(
      "ORIGIN_REJECTED",
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * B/C. The native contract
 * ------------------------------------------------------------------ */

describe("bearer session (native client)", () => {
  it("reads the thread, the detail, and the confirmation queue", async () => {
    const thread = await listMemories(get("/api/memories", OWNER_TOKEN));
    const detail = await getMemory(
      get(`/api/memories/${MEMORY_ID}`, OWNER_TOKEN),
      {
        params: Promise.resolve({ id: MEMORY_ID }),
      },
    );
    const gaps = await listGaps(get("/api/gaps", OWNER_TOKEN));

    expect([thread.status, detail.status, gaps.status]).toEqual([
      200, 200, 200,
    ]);
    expect(
      ApiSuccessSchema(MemoryThreadTransportSchema).parse(await thread.json())
        .data.memories,
    ).toHaveLength(1);
    expect(
      ApiSuccessSchema(MemoryDetailTransportSchema).parse(await detail.json())
        .data.memory.id,
    ).toBe(MEMORY_ID);
    expect(
      ApiSuccessSchema(ConfirmationQueueTransportSchema).parse(
        await gaps.json(),
      ).data.gaps[0],
    ).toMatchObject({ id: GAP_ID, memoryId: MEMORY_ID, state: "open" });
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });

  it("confirms a gap with no browser origin at all", async () => {
    const response = await confirmGap(
      post(
        `/api/gaps/${GAP_ID}/confirm`,
        { decision: "confirm" },
        // A native app is cross-site by definition and sends no Origin.
        {
          authorization: `Bearer ${OWNER_TOKEN}`,
          "sec-fetch-site": "cross-site",
        },
      ),
      gapParams,
    );
    const envelope = ApiSuccessSchema(ConfirmationMutationResponseSchema).parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(envelope.data).toEqual({ saved: true, createdClaimId: CLAIM_ID });
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_memory_gap_correction",
      expect.objectContaining({ p_user_id: OWNER_ID, p_gap_id: GAP_ID }),
    );
  });

  it("derives the owner from the token and ignores a user id in the body", async () => {
    const response = await confirmGap(
      post(
        `/api/gaps/${GAP_ID}/confirm`,
        { decision: "confirm", userId: OTHER_ID },
        { authorization: `Bearer ${OWNER_TOKEN}` },
      ),
      gapParams,
    );

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe(
      "INVALID_INPUT",
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * D/E. Rejected tokens
 * ------------------------------------------------------------------ */

describe("rejected bearer tokens", () => {
  it.each([
    ["a revoked or expired token", `Bearer ${REVOKED_TOKEN}`],
    ["a token of the wrong scheme", "Basic dXNlcjpwYXNzd29yZA=="],
    ["an empty bearer header", "Bearer "],
    ["a token with illegal characters", "Bearer not a token"],
  ])("answers 401 for %s and starts no session", async (_label, header) => {
    const response = await listMemories(
      new NextRequest("http://localhost/api/memories", {
        headers: { authorization: header },
      }),
    );

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe(
      "AUTH_TOKEN_INVALID",
    );
    // No Public Preview fallback: no preview user, no preview cookie.
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("refuses to mutate with a rejected token", async () => {
    const response = await confirmGap(
      post(
        `/api/gaps/${GAP_ID}/confirm`,
        { decision: "confirm" },
        { authorization: `Bearer ${REVOKED_TOKEN}` },
      ),
      gapParams,
    );

    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * G/H. Cross-user isolation
 * ------------------------------------------------------------------ */

describe("cross-user isolation under bearer auth", () => {
  it("returns none of another user's memories", async () => {
    const thread = await listMemories(get("/api/memories", OTHER_TOKEN));
    const detail = await getMemory(
      get(`/api/memories/${MEMORY_ID}`, OTHER_TOKEN),
      {
        params: Promise.resolve({ id: MEMORY_ID }),
      },
    );
    const gaps = await listGaps(get("/api/gaps", OTHER_TOKEN));

    expect(
      ApiSuccessSchema(MemoryThreadTransportSchema).parse(await thread.json())
        .data.memories,
    ).toEqual([]);
    expect(detail.status).toBe(404);
    expect(ApiErrorSchema.parse(await detail.json()).error.code).toBe(
      "MEMORY_NOT_FOUND",
    );
    expect(
      ApiSuccessSchema(ConfirmationQueueTransportSchema).parse(
        await gaps.json(),
      ).data.gaps,
    ).toEqual([]);
  });

  it("writes nothing when confirming another user's gap", async () => {
    const response = await confirmGap(
      post(
        `/api/gaps/${GAP_ID}/confirm`,
        { decision: "confirm" },
        { authorization: `Bearer ${OTHER_TOKEN}` },
      ),
      gapParams,
    );

    expect(response.status).toBe(404);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe(
      "GAP_NOT_FOUND",
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * K. Token confinement
 * ------------------------------------------------------------------ */

describe("token confinement", () => {
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
  const captured: string[] = [];

  beforeEach(() => {
    captured.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      consoleSpies.push(
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          captured.push(args.map((value) => JSON.stringify(value)).join(" "));
        }),
      );
    }
  });

  afterEach(() => {
    consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
  });

  it("keeps the token out of every response body and console sink", async () => {
    const accepted = await listMemories(get("/api/memories", OWNER_TOKEN));
    const rejected = await listMemories(get("/api/memories", REVOKED_TOKEN));
    const bodies = [await accepted.text(), await rejected.text()];

    for (const sink of [...bodies, ...captured]) {
      expect(sink).not.toContain(OWNER_TOKEN);
      expect(sink).not.toContain(REVOKED_TOKEN);
      expect(sink).not.toContain("owner-access-token-fixture");
    }
    // The token did reach the Supabase client, so the assertion above is not
    // vacuous.
    expect(mocks.bearerTokens).toContain(OWNER_TOKEN);
  });
});

/* ------------------------------------------------------------------ *
 * Route-level invariant
 * ------------------------------------------------------------------ */

describe("client contract route invariants", () => {
  const routes = [
    "app/api/memories/route.ts",
    "app/api/memories/[id]/route.ts",
    "app/api/gaps/route.ts",
    "app/api/gaps/[id]/confirm/route.ts",
    "app/api/upload/prepare/route.ts",
    "app/api/upload/complete/route.ts",
    "app/api/search/route.ts",
  ] as const;

  const source = (path: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../${path}`, import.meta.url)),
      "utf8",
    );

  it("resolves the request auth context on every contract route", () => {
    for (const route of routes) {
      expect(source(route)).toMatch(/resolveRequestAuth\(request\)/u);
    }
  });

  it("pairs every relaxed origin check with a verified identity", () => {
    // assertMutationAllowed skips the origin check for bearer callers, so a
    // route that uses it must resolve (and therefore verify) the token.
    for (const route of routes) {
      const text = source(route);
      if (!text.includes("assertMutationAllowed(request)")) continue;
      expect(text).toMatch(/resolveRequestAuth\(request\)/u);
      expect(text).not.toMatch(/assertSameOrigin/u);
    }
  });

  it("never trusts a caller-supplied user id", () => {
    for (const route of routes) {
      expect(source(route)).not.toMatch(/userId:\s*input\./u);
      expect(source(route)).not.toMatch(/input\.userId/u);
    }
  });
});
