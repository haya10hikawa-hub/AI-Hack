import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  assertSameOrigin,
  RequestSecurityError,
} from "@/src/server/http/security";

const originalOrigin = process.env.APP_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = originalOrigin;
});

describe("state-changing request boundary", () => {
  it("uses the canonical origin and ignores a forged forwarded host", () => {
    process.env.APP_ORIGIN = "https://memory.example";
    const request = new NextRequest("https://internal.example/api/upload", {
      method: "POST",
      headers: {
        origin: "https://memory.example",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects both origin mismatch and cross-site browser metadata", () => {
    process.env.APP_ORIGIN = "https://memory.example";
    const wrongOrigin = new NextRequest("https://memory.example/api/upload", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    const crossSite = new NextRequest("https://memory.example/api/upload", {
      method: "POST",
      headers: {
        origin: "https://memory.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(() => assertSameOrigin(wrongOrigin)).toThrow(RequestSecurityError);
    expect(() => assertSameOrigin(crossSite)).toThrow(RequestSecurityError);
  });
});
