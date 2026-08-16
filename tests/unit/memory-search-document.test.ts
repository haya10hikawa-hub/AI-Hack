import { describe, expect, it } from "vitest";

import {
  buildMemorySearchDocument,
  type MemorySearchDocumentInput,
} from "@/src/domain/memory-search-document";

const input: MemorySearchDocumentInput = {
  memoryId: "memory-a",
  title: " Robot workshop ",
  summary: "A day of building.",
  capturedAt: "2026-04-12T09:00:00.000Z",
  coarsePlace: "Kamiyama",
  semantics: [
    {
      assetId: "asset-a",
      facets: [
        {
          type: "activity",
          value: "Assembling robot",
          confidenceBand: "high",
          uncertainty: null,
        },
        {
          type: "activity",
          value: "assembling  robot",
          confidenceBand: "medium",
          uncertainty: null,
        },
        {
          type: "object",
          value: "robot",
          confidenceBand: "low",
          uncertainty: "partly hidden",
        },
      ],
    },
  ],
  claims: [
    {
      field: "purpose",
      value: "club activity",
      origin: "ai" as const,
      confidenceBand: "high" as const,
      confirmationStatus: "unconfirmed" as const,
      status: "active",
      evidenceCount: 1,
    },
    {
      field: "purpose",
      value: "FTC practice",
      origin: "user" as const,
      confidenceBand: "high" as const,
      confirmationStatus: "user_confirmed" as const,
      status: "active",
      evidenceCount: 0,
    },
    {
      field: "exact_gps",
      value: "35.68, 139.76",
      origin: "deterministic" as const,
      confidenceBand: "high" as const,
      confirmationStatus: "unconfirmed" as const,
      status: "active",
      evidenceCount: 1,
    },
    {
      field: "activity",
      value: "disputed",
      origin: "ai" as const,
      confidenceBand: "high" as const,
      confirmationStatus: "disputed" as const,
      status: "active",
      evidenceCount: 1,
    },
  ],
};

describe("Memory Search Document", () => {
  it("is deterministic, deduplicated, and excludes private or ineligible state", () => {
    const first = buildMemorySearchDocument(input);
    const second = buildMemorySearchDocument(structuredClone(input));
    expect(first).toEqual(second);
    expect(first.activities).toEqual(["assembling robot"]);
    expect(first.groundedClaims).toEqual([
      { field: "purpose", value: "FTC practice", truthLayer: "user_confirmed" },
    ]);
    expect(first.searchableText).not.toContain("35.68");
    expect(first.searchableText).not.toContain("club activity");
    expect(first.version).toBe("memory-search-v1");
  });

  it("changes its stable hash when corrected grounded content changes", () => {
    const before = buildMemorySearchDocument(input);
    const after = buildMemorySearchDocument({
      ...input,
      claims: input.claims.map((claim) =>
        claim.field === "purpose" && claim.origin === "user"
          ? { ...claim, value: "competition preparation" }
          : claim,
      ),
    });
    expect(after.contentHash).not.toBe(before.contentHash);
  });
});
