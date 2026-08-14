import { z } from "zod";

export const EventFacetTypeSchema = z.enum([
  "activity",
  "object",
  "people_group",
  "environment",
  "moment",
  "detail",
  "visible_text",
]);

export type EventFacetType = z.infer<typeof EventFacetTypeSchema>;

export const EventFacetSchema = z
  .object({
    type: EventFacetTypeSchema,
    value: z.string().trim().min(1).max(500),
    confidenceBand: z.enum(["low", "medium", "high"]),
    uncertainty: z.string().trim().min(1).max(300).nullable(),
  })
  .strict()
  .refine(
    ({ confidenceBand, uncertainty }) =>
      confidenceBand !== "low" || uncertainty !== null,
    { message: "Low-confidence facets require an uncertainty." },
  );

export const AssetSemanticRepresentationSchema = z
  .object({
    assetId: z.string().min(1).max(200),
    facets: z.array(EventFacetSchema).max(50),
  })
  .strict();

export type AssetSemanticRepresentation = z.infer<
  typeof AssetSemanticRepresentationSchema
>;

/** Validates, normalizes, deduplicates, and orders the reusable Domain form. */
export function normalizeAssetSemanticRepresentations(
  input: readonly unknown[],
): AssetSemanticRepresentation[] {
  const assets = input.map((value) =>
    AssetSemanticRepresentationSchema.parse(value),
  );
  if (new Set(assets.map(({ assetId }) => assetId)).size !== assets.length) {
    throw new Error("Semantic representations require unique asset ids.");
  }
  return assets
    .map(({ assetId, facets }) => ({
      assetId,
      facets: [
        ...new Map(
          facets.map((facet) => {
            const normalized = {
              ...facet,
              value: facet.value.normalize("NFKC").replace(/\s+/gu, " ").trim(),
              uncertainty:
                facet.uncertainty
                  ?.normalize("NFKC")
                  .replace(/\s+/gu, " ")
                  .trim() ?? null,
            };
            return [
              `${normalized.type}\0${normalized.value.toLocaleLowerCase("en-US")}`,
              normalized,
            ] as const;
          }),
        ).values(),
      ].sort(
        (left, right) =>
          left.type.localeCompare(right.type) ||
          left.value.localeCompare(right.value),
      ),
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
}

export function describeEventSemantics(
  representations: readonly AssetSemanticRepresentation[],
): { title: string; summary: string } {
  const facets = representations
    .flatMap(({ facets }) => facets)
    .filter(
      ({ confidenceBand, type }) =>
        confidenceBand !== "low" && type !== "visible_text",
    );
  const titleFacet =
    facets.find(({ type }) => type === "activity") ??
    facets.find(({ type }) => type === "environment") ??
    facets.find(({ type }) => type === "object");
  const values = [...new Set(facets.map(({ value }) => value))];
  return {
    title: titleFacet?.value.slice(0, 120) ?? "内容を確認中の記憶",
    summary:
      values.length === 0
        ? "写真から確実に説明できる内容がまだありません。"
        : `写真から確認できる内容：${values.slice(0, 3).join("、")}`.slice(
            0,
            800,
          ),
  };
}
