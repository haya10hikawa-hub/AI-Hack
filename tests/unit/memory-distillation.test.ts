import { describe, expect, it } from "vitest";

import { distillMemoryRepresentatives } from "@/src/domain/memory-distillation";

type Facet = {
  type:
    | "activity"
    | "object"
    | "people_group"
    | "environment"
    | "moment"
    | "detail"
    | "visible_text";
  value: string;
  confidenceBand: "low" | "medium" | "high";
  uncertainty: string | null;
};
const facet = (
  type: Facet["type"],
  value: string,
  confidenceBand: Facet["confidenceBand"] = "high",
): Facet => ({
  type,
  value,
  confidenceBand,
  uncertainty: confidenceBand === "low" ? "uncertain" : null,
});
const candidate = (
  assetId: string,
  facets: Facet[],
  capturedAt: string | null = null,
) => ({
  assetId,
  capturedAt,
  semantics: { assetId, facets },
});

const four = [
  candidate(
    "a",
    [
      facet("environment", "workshop"),
      facet("people_group", "team"),
      facet("object", "robot"),
    ],
    "2026-08-14T09:00:00Z",
  ),
  candidate(
    "b",
    [facet("activity", "assembling"), facet("moment", "part attached")],
    "2026-08-14T09:05:00Z",
  ),
  candidate(
    "c",
    [facet("detail", "wiring"), facet("visible_text", "FTC")],
    "2026-08-14T10:00:00Z",
  ),
  candidate(
    "d",
    [facet("environment", "workshop"), facet("object", "robot")],
    "2026-08-14T09:01:00Z",
  ),
];

describe("deterministic Domain distillation", () => {
  it("selects coverage, activity, then marginal information with no duplicates", () => {
    const selected = distillMemoryRepresentatives(four);
    expect(selected.map(({ assetId, role }) => [assetId, role])).toEqual([
      ["a", "identity"],
      ["b", "key_moment"],
      ["c", "complement"],
    ]);
    expect(new Set(selected.map(({ assetId }) => assetId)).size).toBe(3);
    expect(new Set(selected.map(({ role }) => role)).size).toBe(3);
    expect(distillMemoryRepresentatives(structuredClone(four))).toEqual(
      selected,
    );
  });

  it("penalizes redundant complements", () => {
    const selected = distillMemoryRepresentatives(four);
    expect(selected.find(({ role }) => role === "complement")?.assetId).toBe(
      "c",
    );
    expect(selected.some(({ assetId }) => assetId === "d")).toBe(false);
  });

  it.each([1, 2, 3, 4])(
    "handles %i candidate assets without duplication",
    (count) => {
      const selected = distillMemoryRepresentatives(four.slice(0, count));
      expect(selected).toHaveLength(Math.min(3, count));
      expect(selected.map(({ role }) => role)).toEqual(
        ["identity", "key_moment", "complement"].slice(0, count),
      );
      expect(new Set(selected.map(({ assetId }) => assetId)).size).toBe(
        selected.length,
      );
    },
  );

  it("uses capturedAt then assetId as the deterministic tie-break", () => {
    const tied = ["d", "b", "c", "a"].map((assetId) =>
      candidate(assetId, [], "2026-08-14T09:00:00Z"),
    );
    expect(
      distillMemoryRepresentatives(tied).map(({ assetId }) => assetId),
    ).toEqual(["a", "b", "c"]);
  });
});
