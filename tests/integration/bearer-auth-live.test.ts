import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { BearerTokenError } from "@/src/server/http/security";
import { resolveRequestAuth } from "@/src/server/supabase/auth";

/**
 * End-to-end proof that a real Supabase access token is verified by the real
 * resolver. Nothing is faked here, so this is the test that would catch a
 * verification path that only looks correct against a mock.
 *
 * Runs only when a Supabase instance is configured. With the local stack:
 *
 *   pnpm dlx supabase@latest start
 *   NEXT_PUBLIC_SUPABASE_URL=$(…API_URL) \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(…PUBLISHABLE_KEY) \
 *   SUPABASE_SECRET_KEY=$(…SECRET_KEY) \
 *   pnpm vitest run tests/integration/bearer-auth-live.test.ts
 *
 * Tokens minted here stay in memory: they are never asserted on, logged, or
 * written to a snapshot.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

const configured =
  supabaseUrl !== undefined &&
  publishableKey !== undefined &&
  secretKey !== undefined;

describe.skipIf(!configured)("bearer auth against a live Supabase", () => {
  const password = `${crypto.randomUUID()}Aa1!`;
  const email = `client-contract-${crypto.randomUUID()}@rememory.invalid`;
  let admin: ReturnType<typeof createClient>;
  let userId = "";
  let accessToken = "";

  beforeAll(async () => {
    admin = createClient(supabaseUrl!, secretKey!, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    userId = created.data.user!.id;

    const session = await createClient(supabaseUrl!, publishableKey!, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }).auth.signInWithPassword({ email, password });
    expect(session.error).toBeNull();
    accessToken = session.data.session!.access_token;
  });

  afterAll(async () => {
    if (userId !== "") await admin.auth.admin.deleteUser(userId);
  });

  function request(header?: string): NextRequest {
    return new NextRequest("http://localhost/api/memories", {
      headers: header === undefined ? {} : { authorization: header },
    });
  }

  it("resolves the signed-in identity from a real access token", async () => {
    const auth = await resolveRequestAuth(request(`Bearer ${accessToken}`));

    expect(auth.mode).toBe("bearer");
    expect(auth.user.id).toBe(userId);
  });

  it("scopes reads to that identity", async () => {
    const auth = await resolveRequestAuth(request(`Bearer ${accessToken}`));
    const memories = await auth.supabase
      .from("memories")
      .select("id")
      .limit(10);

    // A brand new account owns nothing, and Row Level Security keeps it that
    // way even though the query carries no explicit owner predicate.
    expect(memories.error).toBeNull();
    expect(memories.data).toEqual([]);
  });

  it("rejects a token the auth server does not accept", async () => {
    const forged = `${accessToken.slice(0, -6)}forged`;

    await expect(
      resolveRequestAuth(request(`Bearer ${forged}`)),
    ).rejects.toThrow(BearerTokenError);
  });

  it("rejects a revoked session", async () => {
    const revoked = await createClient(supabaseUrl!, publishableKey!, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }).auth.signInWithPassword({ email, password });
    expect(revoked.error).toBeNull();
    const revokedToken = revoked.data.session!.access_token;
    await admin.auth.admin.signOut(revokedToken, "global");

    await expect(
      resolveRequestAuth(request(`Bearer ${revokedToken}`)),
    ).rejects.toThrow(BearerTokenError);
  });
});
