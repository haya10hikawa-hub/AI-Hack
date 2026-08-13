import { describe, expect, it } from "vitest";

import { coarsenCoordinates, normalizeExifDateTime } from "@/src/domain/exif";
import {
  detectImageMime,
  sha256Hex,
  validateImageBytes,
} from "@/src/domain/media-validation";

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe("media validation", () => {
  it("accepts a matching PNG header and bounded dimensions", () => {
    const result = validateImageBytes({
      bytes: pngHeader(640, 480),
      declaredMimeType: "image/png",
    });
    expect(result).toMatchObject({
      ok: true,
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
  });

  it("rejects MIME spoofing", () => {
    const result = validateImageBytes({
      bytes: pngHeader(640, 480),
      declaredMimeType: "image/jpeg",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map(({ code }) => code)).toContain("mime_mismatch");
  });

  it("rejects decompression-sized dimensions before decoding", () => {
    const result = validateImageBytes({
      bytes: pngHeader(20_000, 20_000),
      declaredMimeType: "image/png",
      limits: {
        maxBytes: 1_000,
        maxWidth: 20_000,
        maxHeight: 20_000,
        maxPixels: 40_000_000,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map(({ code }) => code)).toContain(
        "dimensions_too_large",
      );
  });

  it("does not accept an extension without a recognized magic signature", () => {
    const bytes = new TextEncoder().encode("not an image");
    expect(detectImageMime(bytes)).toBeNull();
    const result = validateImageBytes({
      bytes,
      declaredMimeType: "image/jpeg",
    });
    expect(result.ok).toBe(false);
  });

  it("computes stable SHA-256 digests", async () => {
    await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("privacy-safe EXIF normalization", () => {
  it("normalizes an EXIF local time only when an offset is available", () => {
    expect(normalizeExifDateTime("2026:04:12 09:30:00", "+09:00")).toEqual({
      capturedAt: "2026-04-12T09:30:00+09:00",
      capturedAtLocal: "2026-04-12T09:30:00",
      timezoneOffset: "+09:00",
    });
    expect(
      normalizeExifDateTime("2026:04:12 09:30:00", null).capturedAt,
    ).toBeNull();
  });

  it("returns only an opaque coarse grid key, never exact coordinates", () => {
    const coarse = coarsenCoordinates(35.0116, 134.0234, 0.1);
    expect(coarse.key).toMatch(/^grid:/u);
    expect(coarse.key).not.toContain("35.0116");
    expect(coarse.key).not.toContain("134.0234");
    expect(coarse.precisionKm).toBeGreaterThan(5);
  });
});
