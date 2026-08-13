import { z } from "zod";

export const SupportedImageMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type SupportedImageMime = z.infer<typeof SupportedImageMimeSchema>;

export const ImageValidationLimitsSchema = z
  .object({
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    maxWidth: z.number().int().positive().max(100_000),
    maxHeight: z.number().int().positive().max(100_000),
    maxPixels: z.number().int().positive().max(1_000_000_000),
  })
  .strict();

export type ImageValidationLimits = z.infer<typeof ImageValidationLimitsSchema>;

export const DEFAULT_IMAGE_VALIDATION_LIMITS: Readonly<ImageValidationLimits> =
  Object.freeze({
    maxBytes: 20 * 1024 * 1024,
    maxWidth: 12_000,
    maxHeight: 12_000,
    maxPixels: 40_000_000,
  });

export type MediaValidationCode =
  | "empty_file"
  | "file_too_large"
  | "unsupported_media_type"
  | "mime_mismatch"
  | "invalid_image_header"
  | "invalid_dimensions"
  | "dimensions_too_large";

export interface MediaValidationIssue {
  code: MediaValidationCode;
  message: string;
}

export type ValidatedImage = {
  ok: true;
  mimeType: SupportedImageMime;
  bytes: number;
  width: number;
  height: number;
};

export type InvalidImage = {
  ok: false;
  issues: readonly MediaValidationIssue[];
};

export type ImageValidationResult = ValidatedImage | InvalidImage;

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function normalizeDeclaredMime(value: string): string {
  const normalized = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function readImageDimensions(
  bytes: Uint8Array,
  mimeType: SupportedImageMime,
): { width: number; height: number } | null {
  switch (mimeType) {
    case "image/png":
      return readPngDimensions(bytes);
    case "image/jpeg":
      return readJpegDimensions(bytes);
    case "image/webp":
      return readWebpDimensions(bytes);
  }
}

export function validateImageBytes(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  limits?: ImageValidationLimits;
}): ImageValidationResult {
  const limits = ImageValidationLimitsSchema.parse(
    input.limits ?? DEFAULT_IMAGE_VALIDATION_LIMITS,
  );
  const issues: MediaValidationIssue[] = [];

  if (input.bytes.byteLength === 0) {
    return {
      ok: false,
      issues: [{ code: "empty_file", message: "The uploaded file is empty." }],
    };
  }

  if (input.bytes.byteLength > limits.maxBytes) {
    issues.push({
      code: "file_too_large",
      message: `The image exceeds the ${limits.maxBytes} byte limit.`,
    });
  }

  const declaredMime = normalizeDeclaredMime(input.declaredMimeType);
  const parsedDeclaredMime = SupportedImageMimeSchema.safeParse(declaredMime);
  if (!parsedDeclaredMime.success) {
    issues.push({
      code: "unsupported_media_type",
      message: "Only JPEG, PNG, and WebP images are accepted.",
    });
  }

  const detectedMime = detectImageMime(input.bytes);
  if (detectedMime === null) {
    issues.push({
      code: "invalid_image_header",
      message: "The image signature is missing or unsupported.",
    });
  } else if (
    parsedDeclaredMime.success &&
    parsedDeclaredMime.data !== detectedMime
  ) {
    issues.push({
      code: "mime_mismatch",
      message: "The declared media type does not match the file signature.",
    });
  }

  const dimensions = detectedMime
    ? readImageDimensions(input.bytes, detectedMime)
    : null;
  if (detectedMime !== null && dimensions === null) {
    issues.push({
      code: "invalid_dimensions",
      message: "The encoded image dimensions could not be read safely.",
    });
  } else if (dimensions !== null) {
    const pixels = dimensions.width * dimensions.height;
    if (
      dimensions.width > limits.maxWidth ||
      dimensions.height > limits.maxHeight ||
      !Number.isSafeInteger(pixels) ||
      pixels > limits.maxPixels
    ) {
      issues.push({
        code: "dimensions_too_large",
        message: "The decoded image dimensions exceed the configured limit.",
      });
    }
  }

  if (issues.length > 0 || detectedMime === null || dimensions === null) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    mimeType: detectedMime,
    bytes: input.bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("SHA-256 is unavailable in this runtime.");
  }

  const stableBuffer = Uint8Array.from(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stableBuffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function duplicateScopeKey(userId: string, sha256: string): string {
  const normalizedUserId = userId.trim();
  const normalizedHash = sha256.trim().toLowerCase();

  if (normalizedUserId.length === 0 || !/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw new Error("A user id and a valid SHA-256 digest are required.");
  }

  return `${normalizedUserId}:${normalizedHash}`;
}

function readPngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") {
    return null;
  }

  return validDimensions(readU32BE(bytes, 16), readU32BE(bytes, 20));
}

function readJpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let cursor = 2;

  while (cursor + 3 < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }

    while (cursor < bytes.length && bytes[cursor] === 0xff) {
      cursor += 1;
    }

    const marker = bytes[cursor];
    cursor += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (cursor + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = readU16BE(bytes, cursor);
    if (segmentLength < 2 || cursor + segmentLength > bytes.length) {
      return null;
    }

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }
      return validDimensions(
        readU16BE(bytes, cursor + 5),
        readU16BE(bytes, cursor + 3),
      );
    }

    cursor += segmentLength;
  }

  return null;
}

function readWebpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 30) {
    return null;
  }

  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return validDimensions(1 + readU24LE(bytes, 24), 1 + readU24LE(bytes, 27));
  }

  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21]!;
    const b2 = bytes[22]!;
    const b3 = bytes[23]!;
    const b4 = bytes[24]!;
    return validDimensions(
      1 + (((b2 & 0x3f) << 8) | b1),
      1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
    );
  }

  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return validDimensions(
      readU16LE(bytes, 26) & 0x3fff,
      readU16LE(bytes, 28) & 0x3fff,
    );
  }

  return null;
}

function validDimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let result = "";
  for (let index = start; index < start + length; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }
  return result;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}
