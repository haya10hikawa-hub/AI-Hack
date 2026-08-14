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
  it("supports recovery without revealing whether an email exists", () => {
    const reset = source("app/api/auth/password-reset/route.ts");
    expect(reset).toContain("resetPasswordForEmail");
    expect(reset).toContain("/auth/confirm?next=/auth/update-password");
    expect(reset).not.toContain("USER_NOT_FOUND");
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
});
