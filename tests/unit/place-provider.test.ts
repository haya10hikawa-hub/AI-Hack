import { describe, expect, it, vi } from "vitest";

import {
  PlaceProviderUnavailableError,
  createPlaceProviderFromEnv,
} from "@/src/server/places/provider";

const kamiyama = {
  osm_type: "node",
  osm_id: 101,
  lat: "34.01234567",
  lon: "134.12345678",
  name: "神山中学校",
  display_name: "神山中学校, 神山町, 徳島県",
  addresstype: "school",
  address: { state: "徳島県", town: "神山町" },
};

describe("place provider privacy and validation", () => {
  it("returns distinct public candidates without exact coordinates", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          kamiyama,
          {
            ...kamiyama,
            osm_id: 102,
            address: { state: "香川県", city: "高松市" },
          },
        ]),
        { status: 200 },
      ),
    );
    const provider = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation,
    });

    const candidates = await provider.search("神山中学校");

    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ id, area }) => ({ id, area }))).toEqual([
      { id: "nominatim:N101", area: "徳島県 神山町" },
      { id: "nominatim:N102", area: "香川県 高松市" },
    ]);
    expect(JSON.stringify(candidates)).not.toMatch(
      /34\.01234567|134\.12345678/u,
    );
  });

  it("revalidates a candidate and reduces coordinates to an H3 cell", async () => {
    const provider = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify([kamiyama]), { status: 200 }),
        ),
    });

    const selected = await provider.resolve("nominatim:N101");

    expect(selected).toMatchObject({
      provider: "nominatim",
      providerPlaceId: "N101",
      displayName: "神山中学校",
      coarseArea: "徳島県 神山町",
      category: "school",
    });
    expect(selected?.mapCellId).toMatch(/^[0-9a-f]{15}$/u);
    expect(JSON.stringify(selected)).not.toMatch(/34\.01234567|134\.12345678/u);
  });

  it("rejects forged IDs before calling the provider", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation,
    });

    await expect(
      provider.resolve("nominatim:N101<script>"),
    ).resolves.toBeNull();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("normalizes malformed provider responses to an unavailable error", async () => {
    const provider = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}", { status: 200 })),
    });

    await expect(provider.search("神山")).rejects.toBeInstanceOf(
      PlaceProviderUnavailableError,
    );
  });

  it("returns zero or one candidate without manufacturing results", async () => {
    const empty = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("[]", { status: 200 })),
    });
    const single = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify([kamiyama]), { status: 200 }),
        ),
    });

    await expect(empty.search("候補なし")).resolves.toEqual([]);
    await expect(single.search("単一候補")).resolves.toHaveLength(1);
  });

  it("deduplicates provider rows and discards malformed provider IDs", async () => {
    const provider = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify([
              kamiyama,
              kamiyama,
              { ...kamiyama, osm_id: "../101" },
            ]),
            { status: 200 },
          ),
        ),
    });

    await expect(provider.search("神山中学校")).resolves.toHaveLength(1);
  });

  it("turns a provider timeout into an unavailable error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          );
        }),
    );
    const provider = createPlaceProviderFromEnv({
      endpoint: "http://provider.test",
      fetchImplementation,
      timeoutMs: 5,
    });

    await expect(provider.search("神山")).rejects.toBeInstanceOf(
      PlaceProviderUnavailableError,
    );
  });
});
