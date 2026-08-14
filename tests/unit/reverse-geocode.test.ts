import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { coarsenCoordinates } from "@/src/domain/exif";
import { resolveCoarseLocationLabel } from "@/src/server/services/reverse-geocode";

function databaseWithCachedLabel(label: string | null) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: label === null ? null : { label },
    error: null,
  });
  const database = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
      upsert,
    })),
  } as unknown as SupabaseClient;
  return { database, upsert };
}

describe("privacy-safe reverse geocoding", () => {
  it("uses a cached coarse label without an external request", async () => {
    const { database } = databaseWithCachedLabel("徳島県神山町");
    const fetchImplementation = vi.fn();
    const previous = process.env.GEOCODER_API_BASE_URL;
    process.env.GEOCODER_API_BASE_URL = "https://geo.example/reverse";
    try {
      await expect(
        resolveCoarseLocationLabel({
          database,
          location: coarsenCoordinates(33.967, 134.35),
          fetchImplementation,
        }),
      ).resolves.toBe("徳島県神山町");
      expect(fetchImplementation).not.toHaveBeenCalled();
    } finally {
      process.env.GEOCODER_API_BASE_URL = previous;
    }
  });

  it("sends only the coarse grid center and caches the locality", async () => {
    const { database, upsert } = databaseWithCachedLabel(null);
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ address: { state: "徳島県", town: "神山町" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const previous = process.env.GEOCODER_API_BASE_URL;
    process.env.GEOCODER_API_BASE_URL = "https://geo.example/reverse";
    try {
      const location = coarsenCoordinates(33.967123, 134.350987, 0.1);
      await expect(
        resolveCoarseLocationLabel({
          database,
          location,
          fetchImplementation,
        }),
      ).resolves.toBe("徳島県神山町");
      const requested = new URL(String(fetchImplementation.mock.calls[0]?.[0]));
      expect(requested.searchParams.get("lat")).not.toBe("33.967123");
      expect(requested.searchParams.get("lon")).not.toBe("134.350987");
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          grid_key: location.key,
          label: "徳島県神山町",
        }),
        { onConflict: "grid_key" },
      );
    } finally {
      process.env.GEOCODER_API_BASE_URL = previous;
    }
  });
});
