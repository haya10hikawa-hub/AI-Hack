import { createHash } from "node:crypto";

import {
  normalizeAssetSemanticRepresentations,
  type AssetSemanticRepresentation,
  type EventFacetType,
} from "./event-semantics";

const VERSION = "memory-search-v1";
type FacetListKey =
  | "activities"
  | "objects"
  | "peopleGroups"
  | "environments"
  | "moments"
  | "details"
  | "visibleTexts";

const FACET_KEYS: Record<EventFacetType, FacetListKey> = {
  activity: "activities",
  object: "objects",
  people_group: "peopleGroups",
  environment: "environments",
  moment: "moments",
  detail: "details",
  visible_text: "visibleTexts",
};

export interface MemorySearchDocument {
  memoryId: string;
  title: string | null;
  summary: string | null;
  capturedAt: string | null;
  coarsePlace: string | null;
  activities: string[];
  objects: string[];
  peopleGroups: string[];
  environments: string[];
  moments: string[];
  details: string[];
  visibleTexts: string[];
  groundedClaims: Array<{
    field: string;
    value: string;
    truthLayer: "deterministic" | "ai_inference" | "user_confirmed";
  }>;
  searchableText: string;
  version: typeof VERSION;
  contentHash: string;
}

export interface MemorySearchDocumentInput {
  memoryId: string;
  title: string | null;
  summary: string | null;
  capturedAt: string | null;
  coarsePlace: string | null;
  semantics: readonly AssetSemanticRepresentation[];
  claims: ReadonlyArray<{
    field: string;
    value: unknown;
    origin: "deterministic" | "ai" | "user";
    confidenceBand: "low" | "medium" | "high" | "unsupported";
    confirmationStatus: "unconfirmed" | "user_confirmed" | "disputed";
    status: string;
    evidenceCount: number;
  }>;
}

/** Provider boundary only; vectors remain derived and optional. */
export interface MemoryEmbeddingProvider {
  embedMemoryDocument(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}

/** Builds the reusable, privacy-safe search projection from persisted state only. */
export function buildMemorySearchDocument(
  input: MemorySearchDocumentInput,
): MemorySearchDocument {
  const facets: Pick<MemorySearchDocument, FacetListKey> = {
    activities: [],
    objects: [],
    peopleGroups: [],
    environments: [],
    moments: [],
    details: [],
    visibleTexts: [],
  };
  for (const asset of normalizeAssetSemanticRepresentations(input.semantics)) {
    for (const facet of asset.facets) {
      if (facet.confidenceBand !== "low")
        facets[FACET_KEYS[facet.type]].push(facet.value);
    }
  }
  for (const key of Object.keys(facets) as FacetListKey[]) {
    facets[key] = unique(facets[key]);
  }
  const groundedClaims = input.claims
    .filter(isEligibleClaim)
    .map((claim) => ({
      field: clean(claim.field),
      value: displayValue(claim.value),
      truthLayer:
        claim.origin === "user"
          ? ("user_confirmed" as const)
          : claim.origin === "ai"
            ? ("ai_inference" as const)
            : ("deterministic" as const),
    }))
    .filter(({ field, value }) => field && value && !privateField(field));
  const confirmedFields = new Set(
    groundedClaims
      .filter(({ truthLayer }) => truthLayer === "user_confirmed")
      .map(({ field }) => normalized(field)),
  );
  const claims = uniqueClaims(
    groundedClaims.filter(
      (claim) =>
        claim.truthLayer === "user_confirmed" ||
        !confirmedFields.has(normalized(claim.field)),
    ),
  );
  const document: Omit<MemorySearchDocument, "searchableText" | "contentHash"> =
    {
      memoryId: input.memoryId,
      title: nullableText(input.title),
      summary: nullableText(input.summary),
      capturedAt: input.capturedAt,
      coarsePlace: nullableText(input.coarsePlace),
      ...facets,
      groundedClaims: claims,
      version: VERSION,
    };
  const searchableText = sections(document);
  return {
    ...document,
    searchableText,
    contentHash: createHash("sha256")
      .update(JSON.stringify({ ...document, searchableText }))
      .digest("hex"),
  };
}

function isEligibleClaim(claim: MemorySearchDocumentInput["claims"][number]) {
  return (
    claim.status === "active" &&
    claim.confirmationStatus !== "disputed" &&
    (claim.origin === "user"
      ? claim.confirmationStatus === "user_confirmed"
      : claim.confidenceBand !== "low" &&
        claim.confidenceBand !== "unsupported" &&
        claim.evidenceCount > 0)
  );
}

function sections(
  document: Omit<MemorySearchDocument, "searchableText" | "contentHash">,
) {
  const named = [
    ["Title", document.title ? [document.title] : []],
    ["Summary", document.summary ? [document.summary] : []],
    ["Place", document.coarsePlace ? [document.coarsePlace] : []],
    ["Activities", document.activities],
    ["Objects", document.objects],
    ["People", document.peopleGroups],
    ["Environment", document.environments],
    ["Moments", document.moments],
    ["Details", document.details],
    ["Visible text", document.visibleTexts],
    [
      "Confirmed context",
      document.groundedClaims.map(({ field, value }) => `${field}: ${value}`),
    ],
  ] as const;
  return named
    .filter(([, values]) => values.length > 0)
    .map(([label, values]) => `${label}: ${values.join("\n")}`)
    .join("\n\n");
}

function displayValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return clean(String(value));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of [
      "value",
      "label",
      "text",
      "name",
      "activity",
      "purpose",
    ]) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === "string") return clean(candidate);
    }
  }
  return "";
}

function privateField(field: string) {
  return /^(?:exact_)?(?:gps|lat(?:itude)?|lng|lon(?:gitude)?|raw_exif|exif|storage_path|user_id)$/iu.test(
    field,
  );
}

function nullableText(value: string | null) {
  const result = value === null ? "" : clean(value);
  return result || null;
}

function clean(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalized(value: string) {
  return clean(value).toLocaleLowerCase("en-US");
}

function unique(values: readonly string[]) {
  return [
    ...new Map(
      values.map((value) => [normalized(value), clean(value)]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
}

function uniqueClaims(claims: MemorySearchDocument["groundedClaims"]) {
  return [
    ...new Map(
      claims.map((claim) => [
        `${normalized(claim.field)}\0${normalized(claim.value)}`,
        claim,
      ]),
    ).values(),
  ].sort(
    (a, b) => a.field.localeCompare(b.field) || a.value.localeCompare(b.value),
  );
}
