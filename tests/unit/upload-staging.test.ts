import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createUploadManifest,
  UploadManifestError,
  verifyUploadManifest,
  type UploadManifest,
} from "@/src/server/services/upload-staging";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "unit-test-upload-manifest-secret-that-is-not-production";
const NOW = Date.UTC(2026, 7, 15, 1, 0, 0);
const HOUR_MS = 60 * 60_000;

const DEFAULT_FILES = [
  {
    name: "camera/photo.jpg",
    mimeType: "image/jpeg" as const,
    bytes: 1_024,
  },
  {
    name: "camera/photo.jpg",
    mimeType: "image/jpeg" as const,
    bytes: 1_024,
  },
];

function verify(
  token: string,
  overrides: Partial<Parameters<typeof verifyUploadManifest>[0]> = {},
) {
  return verifyUploadManifest({
    token,
    expectedUserId: USER_ID,
    secret: SECRET,
    maxFiles: 12,
    maxBytesPerFile: 15 * 1024 * 1024,
    now: NOW,
    ...overrides,
  });
}

function decodeManifest(token: string): UploadManifest {
  const [encoded] = token.split(".");
  if (!encoded) throw new Error("Test manifest token was malformed.");
  return JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as UploadManifest;
}

function signPayload(payload: unknown, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update("rememory-upload-manifest-v1\0")
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function mutateAndSign(
  token: string,
  mutate: (manifest: UploadManifest) => void,
): string {
  const manifest = structuredClone(decodeManifest(token));
  mutate(manifest);
  return signPayload(manifest);
}

describe("upload staging manifests", () => {
  it("creates and verifies canonical, owner-bound upload slots", () => {
    const created = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES,
      secret: SECRET,
      now: NOW,
    });

    expect(created.manifest).toMatchObject({
      version: 1,
      userId: USER_ID,
      expiresAt: NOW + HOUR_MS,
    });
    expect(created.manifest.files.map(({ name }) => name)).toEqual([
      "camera_photo.jpg",
      "camera_photo.jpg",
    ]);
    expect(
      new Set(created.manifest.files.map(({ slotId }) => slotId)).size,
    ).toBe(2);
    expect(
      new Set(created.manifest.files.map(({ assetId }) => assetId)).size,
    ).toBe(2);
    for (const file of created.manifest.files) {
      expect(file.path).toBe(`${USER_ID}/assets/${file.assetId}/original`);
    }

    expect(verify(created.token)).toEqual(created.manifest);
  });

  it("rejects a payload changed without a matching signature", () => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES.slice(0, 1),
      secret: SECRET,
      now: NOW,
    });
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) throw new Error("Test token was malformed.");
    const changedFirstCharacter = encoded.startsWith("A") ? "B" : "A";
    const tampered = `${changedFirstCharacter}${encoded.slice(1)}.${signature}`;

    expect(() => verify(tampered)).toThrowError(UploadManifestError);
    expect(() => verify(tampered)).toThrow("signature is invalid");
  });

  it("rejects a correctly signed manifest presented by a different owner", () => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES.slice(0, 1),
      secret: SECRET,
      now: NOW,
    });

    expect(() => verify(token, { expectedUserId: OTHER_USER_ID })).toThrow(
      "owner does not match",
    );
  });

  it("rejects an expired manifest, including the exact expiry boundary", () => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES.slice(0, 1),
      secret: SECRET,
      now: NOW,
    });

    expect(() => verify(token, { now: NOW + HOUR_MS })).toThrow("has expired");
  });

  it("rejects a manifest whose lifetime is outside the runtime clock-skew bound", () => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES.slice(0, 1),
      secret: SECRET,
      now: NOW + 10 * 60_000 + 1,
    });

    expect(() => verify(token)).toThrow("has expired");
  });

  it("rechecks file-count and per-file byte limits at completion time", () => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES,
      secret: SECRET,
      now: NOW,
    });

    expect(() => verify(token, { maxFiles: 1 })).toThrow(
      "exceeds configured limits",
    );
    expect(() => verify(token, { maxBytesPerFile: 1_023 })).toThrow(
      "exceeds configured limits",
    );
  });

  it("rejects an oversized token before decoding it", () => {
    expect(() => verify("a".repeat(32_001))).toThrow("manifest is too large");
  });

  it("rejects a signed path that is not the canonical reserved asset path", () => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES.slice(0, 1),
      secret: SECRET,
      now: NOW,
    });
    const nonCanonical = mutateAndSign(token, (manifest) => {
      const file = manifest.files[0]!;
      file.path = `${manifest.userId}/assets/${file.assetId}/../original`;
    });

    expect(() => verify(nonCanonical)).toThrow("path is invalid");
  });

  it.each([
    {
      label: "slot id",
      mutate: (manifest: UploadManifest) => {
        manifest.files[1]!.slotId = manifest.files[0]!.slotId;
      },
    },
    {
      label: "asset id and path",
      mutate: (manifest: UploadManifest) => {
        manifest.files[1]!.assetId = manifest.files[0]!.assetId;
        manifest.files[1]!.path = manifest.files[0]!.path;
      },
    },
  ])("rejects duplicate $label metadata", ({ mutate }) => {
    const { token } = createUploadManifest({
      userId: USER_ID,
      files: DEFAULT_FILES,
      secret: SECRET,
      now: NOW,
    });

    expect(() => verify(mutateAndSign(token, mutate))).toThrow(
      "metadata is duplicated",
    );
  });
});
