import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SupportedImageMime } from "@/src/domain/media-validation";

const SupportedMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

const StagedFileSchema = z.object({
  slotId: z.uuid(),
  assetId: z.uuid(),
  path: z.string().min(1).max(500),
  name: z.string().min(1).max(180),
  mimeType: SupportedMimeSchema,
  bytes: z.number().int().positive(),
});

const UploadManifestSchema = z.object({
  version: z.literal(1),
  userId: z.uuid(),
  batchId: z.uuid(),
  expiresAt: z.number().int().positive(),
  files: z.array(StagedFileSchema).min(1).max(20),
});

export interface UploadDescriptor {
  name: string;
  mimeType: SupportedImageMime;
  bytes: number;
}

export type UploadManifest = z.infer<typeof UploadManifestSchema>;

export class UploadManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadManifestError";
  }
}

export function createUploadManifest(input: {
  userId: string;
  files: UploadDescriptor[];
  secret: string;
  now?: number;
}): { manifest: UploadManifest; token: string } {
  const batchId = crypto.randomUUID();
  const manifest = UploadManifestSchema.parse({
    version: 1,
    userId: input.userId,
    batchId,
    expiresAt: (input.now ?? Date.now()) + 60 * 60_000,
    files: input.files.map((file) => {
      const slotId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      return {
        slotId,
        assetId,
        path: `${input.userId}/assets/${assetId}/original`,
        name: normalizeFileName(file.name),
        mimeType: file.mimeType,
        bytes: file.bytes,
      };
    }),
  });
  return { manifest, token: signManifest(manifest, input.secret) };
}

export function verifyUploadManifest(input: {
  token: string;
  expectedUserId: string;
  secret: string;
  maxFiles: number;
  maxBytesPerFile: number;
  now?: number;
}): UploadManifest {
  if (input.token.length > 32_000) {
    throw new UploadManifestError("Upload manifest is too large.");
  }
  const [encoded, suppliedSignature, extra] = input.token.split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) {
    throw new UploadManifestError("Upload manifest is malformed.");
  }
  const expectedSignature = signature(encoded, input.secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new UploadManifestError("Upload manifest signature is invalid.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new UploadManifestError("Upload manifest payload is invalid.");
  }
  const parsed = UploadManifestSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new UploadManifestError("Upload manifest payload is invalid.");
  }
  const manifest = parsed.data;
  const now = input.now ?? Date.now();
  if (manifest.userId !== input.expectedUserId) {
    throw new UploadManifestError("Upload manifest owner does not match.");
  }
  if (manifest.expiresAt <= now || manifest.expiresAt > now + 70 * 60_000) {
    throw new UploadManifestError("Upload manifest has expired.");
  }
  if (
    manifest.files.length > input.maxFiles ||
    manifest.files.some(({ bytes }) => bytes > input.maxBytesPerFile)
  ) {
    throw new UploadManifestError("Upload manifest exceeds configured limits.");
  }
  const slotIds = new Set(manifest.files.map(({ slotId }) => slotId));
  const assetIds = new Set(manifest.files.map(({ assetId }) => assetId));
  const paths = new Set(manifest.files.map(({ path }) => path));
  if (
    slotIds.size !== manifest.files.length ||
    assetIds.size !== manifest.files.length ||
    paths.size !== manifest.files.length
  ) {
    throw new UploadManifestError("Upload manifest metadata is duplicated.");
  }
  if (
    manifest.files.some(
      ({ path, assetId }) =>
        path !== `${manifest.userId}/assets/${assetId}/original`,
    )
  ) {
    throw new UploadManifestError("Upload manifest path is invalid.");
  }
  return manifest;
}

function signManifest(manifest: UploadManifest, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(manifest)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

function signature(encoded: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("rememory-upload-manifest-v1\0")
    .update(encoded)
    .digest("base64url");
}

function normalizeFileName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "_")
    .trim();
  return (normalized || "photo").slice(0, 180);
}
