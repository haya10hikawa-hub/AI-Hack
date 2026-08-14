import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("account lifecycle route contract", () => {
  it("keeps legacy email authentication endpoints disabled", () => {
    const signIn = source("app/api/auth/sign-in/route.ts");
    const signUp = source("app/api/auth/sign-up/route.ts");
    const reset = source("app/api/auth/password-reset/route.ts");
    const update = source("app/api/auth/update-password/route.ts");
    const resend = source("app/api/auth/resend-confirmation/route.ts");

    for (const route of [signIn, signUp, reset, update, resend]) {
      expect(route).toContain("AUTH_DISABLED");
    }
    expect(signIn).not.toContain("signInWithPassword");
    expect(signUp).not.toContain("signUp(");
    expect(reset).not.toContain("resetPasswordForEmail");
    expect(update).not.toContain("updateUser");
    expect(resend).not.toContain("auth.resend");
  });

  it("exports owner-scoped records and short-lived media links", () => {
    const route = source("app/api/account/export/route.ts");
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain("createSignedUrls(");
    expect(route).toContain("storageKeys.slice(index, index + 100)");
    expect(route).toContain('"cache-control": "private, no-store"');
  });

  it("removes private media before deleting the Auth account", () => {
    const route = source("app/api/account/delete/route.ts");
    expect(route.indexOf('.from("rememory-private")')).toBeGreaterThan(0);
    expect(route.indexOf("deleteUser(user.id)")).toBeGreaterThan(
      route.indexOf('.from("rememory-private")'),
    );
    expect(route).toContain('z.literal("削除")');
  });

  it("uses a signed public preview cookie instead of trusting a raw user id", () => {
    const auth = source("src/server/supabase/auth.ts");
    expect(auth).toContain("createHmac");
    expect(auth).toContain("timingSafeEqual");
    expect(auth).toContain("serializePreviewCookie");
    expect(auth).toContain("parsePreviewCookie");
    expect(auth).toContain("rememory_public_preview_user");
    expect(auth).not.toContain(
      "const existingId = cookieStore.get(PUBLIC_PREVIEW_COOKIE)?.value;",
    );
  });

  it("lets the server-side service role execute private DB guard functions", () => {
    const migration = source(
      "supabase/migrations/202608150001_allow_service_role_private_guards.sql",
    );
    expect(migration).toContain(
      "grant usage on schema private to service_role",
    );
    expect(migration).toContain(
      "grant execute on all functions in schema private to service_role",
    );
    expect(migration).not.toContain(" to anon");
    expect(migration).not.toContain(" to authenticated");
  });

  it("keeps fresh user corrections from nulling their generated id", () => {
    const migration = source(
      "supabase/migrations/202608150002_fix_apply_user_correction_idempotency.sql",
    );
    expect(migration).toContain("select uc.id, uc.created_claim_id");
    expect(migration).toContain("if found then");
    expect(migration).toContain("v_correction_id := gen_random_uuid();");
    expect(
      migration.indexOf("v_correction_id := gen_random_uuid();"),
    ).toBeGreaterThan(migration.indexOf("end if;"));
  });
});
