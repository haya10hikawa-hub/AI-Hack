import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardedPlaceSearch,
  PlaceSearchRateLimitError,
  resetPlaceSearchGuardForTests,
} from "@/src/server/places/search-guard";

describe("place search guard", () => {
  beforeEach(() => resetPlaceSearchGuardForTests());

  it("caches the same normalized query before calling the provider again", async () => {
    const provider = {
      search: vi.fn().mockResolvedValue([]),
      resolve: vi.fn(),
    };

    await guardedPlaceSearch({ userId: "user-a", query: "神山", provider });
    await guardedPlaceSearch({ userId: "user-a", query: "神山", provider });

    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it("rate limits excessive uncached queries per user", async () => {
    const provider = {
      search: vi.fn().mockResolvedValue([]),
      resolve: vi.fn(),
    };
    for (let index = 0; index < 30; index += 1) {
      await guardedPlaceSearch({
        userId: "user-a",
        query: `神山-${index}`,
        provider,
        now: 1_000,
      });
    }

    await expect(
      guardedPlaceSearch({
        userId: "user-a",
        query: "神山-over-limit",
        provider,
        now: 1_000,
      }),
    ).rejects.toBeInstanceOf(PlaceSearchRateLimitError);
  });
});
