import { describe, expect, it } from "vitest";

import {
  AssetSemanticRepresentationSchema,
  describeEventSemantics,
  normalizeAssetSemanticRepresentations,
} from "@/src/domain/event-semantics";

describe("Event Semantic Representation", () => {
  it("rejects unknown and unsupported personal meaning facet types", () => {
    for (const type of [
      "unknown",
      "purpose",
      "relationship",
      "emotion",
      "exact_location",
    ]) {
      expect(() =>
        AssetSemanticRepresentationSchema.parse({
          assetId: "asset-a",
          facets: [
            {
              type,
              value: "unsupported",
              confidenceBand: "high",
              uncertainty: null,
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("normalizes the same input to the same ordered representation", () => {
    const input = [
      {
        assetId: "asset-b",
        facets: [
          {
            type: "object",
            value: "  Robot   Arm ",
            confidenceBand: "high",
            uncertainty: null,
          },
          {
            type: "activity",
            value: "Build",
            confidenceBand: "medium",
            uncertainty: null,
          },
        ],
      },
    ];
    expect(normalizeAssetSemanticRepresentations(input)).toEqual(
      normalizeAssetSemanticRepresentations(structuredClone(input)),
    );
    expect(
      normalizeAssetSemanticRepresentations(input)[0]!.facets[1]!.value,
    ).toBe("Robot Arm");
  });

  it("retains low confidence with uncertainty but excludes it from presentation", () => {
    const semantics = normalizeAssetSemanticRepresentations([
      {
        assetId: "asset-a",
        facets: [
          {
            type: "activity",
            value: "assembling",
            confidenceBand: "low",
            uncertainty: "hands are obscured",
          },
        ],
      },
    ]);
    expect(semantics[0]!.facets).toHaveLength(1);
    expect(describeEventSemantics(semantics)).toEqual({
      title: "内容を確認中の記憶",
      summary: "写真から確実に説明できる内容がまだありません。",
    });
    expect(() =>
      AssetSemanticRepresentationSchema.parse({
        assetId: "asset-a",
        facets: [
          {
            type: "activity",
            value: "assembling",
            confidenceBand: "low",
            uncertainty: null,
          },
        ],
      }),
    ).toThrow(/uncertainty/u);
  });
});
