import { describe, expect, it, vi } from "vitest";

import { loadMemoryPlaces } from "@/src/server/services/memories";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memoryId = "11111111-1111-4111-8111-111111111111";
const placeId = "22222222-2222-4222-8222-222222222222";
const cellId = "8a2e6e82175ffff";

function resultBuilder(data: unknown) {
  const result = { data, error: null };
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    then: <TResult1 = typeof result>(
      onfulfilled?:
        | ((value: typeof result) => TResult1 | PromiseLike<TResult1>)
        | null,
    ) => Promise.resolve(result).then(onfulfilled),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  return builder;
}

function client(mapLinked: boolean) {
  return {
    from: vi.fn((table: string) =>
      resultBuilder(
        table === "memory_places"
          ? [
              {
                memory_id: memoryId,
                source: "user_selected",
                place: {
                  id: placeId,
                  provider: "nominatim",
                  provider_place_id: "N101",
                  place_label: "神山中学校",
                  coarse_area: "徳島県 神山町",
                  map_cell_id: cellId,
                  place_category: "学校",
                },
              },
            ]
          : mapLinked
            ? [{ memory_id: memoryId, cell_id: cellId }]
            : [],
      ),
    ),
  };
}

describe("canonical Memory places", () => {
  it("returns a confirmed place and a trusted linked Map cell", async () => {
    const places = await loadMemoryPlaces(client(true) as never, userId, [
      memoryId,
    ]);

    expect(places.get(memoryId)).toEqual({
      canonicalId: placeId,
      provider: "nominatim",
      providerPlaceId: "N101",
      label: "神山中学校",
      area: "徳島県 神山町",
      category: "学校",
      source: "user_selected",
      truthState: "confirmed",
      mapCellId: cellId,
    });
  });

  it("never exposes an unlinked canonical cell as a Map handoff", async () => {
    const places = await loadMemoryPlaces(client(false) as never, userId, [
      memoryId,
    ]);

    expect(places.get(memoryId)?.mapCellId).toBeNull();
  });
});
