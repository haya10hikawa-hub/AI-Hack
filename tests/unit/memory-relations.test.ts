import { describe, expect, it } from "vitest";

import {
  deriveMemoryRelations,
  type RelationMemory,
} from "@/src/domain/memory-relations";

function memory(
  id: string,
  input: Partial<Omit<RelationMemory, "id" | "userId">> = {},
): RelationMemory {
  return {
    id,
    userId: "user-a",
    capturedAt: null,
    coarsePlace: null,
    claims: [],
    ...input,
  };
}

function activityClaim(
  id: string,
  overrides: Partial<RelationMemory["claims"][number]> = {},
): RelationMemory["claims"][number] {
  return {
    id,
    field: "activity",
    value: { value: "Robot Build" },
    origin: "ai",
    confidenceBand: "medium",
    confirmationStatus: "unconfirmed",
    status: "active",
    ...overrides,
  };
}

describe("deterministic Memory Relations", () => {
  it("connects only adjacent known chronology and never invents unknown time", () => {
    const current = memory("b", { capturedAt: "2026-04-02T09:00:00Z" });
    const relations = deriveMemoryRelations(current, [
      memory("a", { capturedAt: "2026-04-01T09:00:00Z" }),
      memory("old", { capturedAt: "2026-03-01T09:00:00Z" }),
      memory("c", { capturedAt: "2026-04-03T09:00:00Z" }),
      memory("unknown"),
    ]).filter(({ relationType }) => relationType === "before");
    expect(
      relations.map(({ sourceMemoryId, targetMemoryId }) => [
        sourceMemoryId,
        targetMemoryId,
      ]),
    ).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(deriveMemoryRelations(memory("unknown"), [current])).toEqual([]);
  });

  it("matches only an exact normalized persisted coarse place", () => {
    const relations = deriveMemoryRelations(
      memory("b", { coarsePlace: " 神山 " }),
      [
        memory("a", { coarsePlace: "神山" }),
        memory("c", { coarsePlace: "徳島" }),
        memory("d", { coarsePlace: null }),
      ],
    );
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      sourceMemoryId: "a",
      targetMemoryId: "b",
      relationType: "same_place",
    });
  });

  it("uses eligible exact activity Claims and ignores low, disputed, or deleted ones", () => {
    const current = memory("b", { claims: [activityClaim("claim-b")] });
    const eligible = memory("a", {
      claims: [
        activityClaim("claim-a", {
          origin: "user",
          confirmationStatus: "user_confirmed",
        }),
      ],
    });
    const ignored = [
      activityClaim("low", { confidenceBand: "low" }),
      activityClaim("disputed", {
        confirmationStatus: "disputed",
        status: "disputed",
      }),
      activityClaim("deleted", { status: "deleted" }),
    ];
    const relations = deriveMemoryRelations(current, [
      eligible,
      memory("c", { claims: ignored }),
    ]);
    expect(
      relations.filter(({ relationType }) => relationType === "same_activity"),
    ).toEqual([
      expect.objectContaining({
        sourceMemoryId: "a",
        targetMemoryId: "b",
        relationType: "same_activity",
      }),
    ]);
  });

  it("canonicalizes symmetric pairs, deduplicates them, and skips self relations", () => {
    const current = memory("z", {
      coarsePlace: "神山",
      claims: [activityClaim("claim-z")],
    });
    const relations = deriveMemoryRelations(current, [
      memory("a", {
        coarsePlace: "神山",
        claims: [activityClaim("claim-a")],
      }),
      current,
    ]);
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceMemoryId: "a",
          targetMemoryId: "z",
          relationType: "same_place",
        }),
        expect.objectContaining({
          sourceMemoryId: "a",
          targetMemoryId: "z",
          relationType: "same_activity",
        }),
      ]),
    );
    expect(
      relations.every(
        ({ sourceMemoryId, targetMemoryId }) =>
          sourceMemoryId !== targetMemoryId,
      ),
    ).toBe(true);
  });

  it("rejects a cross-owner candidate", () => {
    expect(() =>
      deriveMemoryRelations(memory("a"), [
        { ...memory("b"), userId: "user-b" },
      ]),
    ).toThrow(/one owner/u);
  });

  it("removes the old same_activity edge and creates the newly eligible edge after correction", () => {
    const robot = memory("current", { claims: [activityClaim("old")] });
    const ftc = memory("current", {
      claims: [
        activityClaim("new", {
          value: { value: "FTC practice" },
          origin: "user",
          confirmationStatus: "user_confirmed",
        }),
      ],
    });
    const candidates = [
      memory("robot", { claims: [activityClaim("robot-claim")] }),
      memory("ftc", {
        claims: [
          activityClaim("ftc-claim", { value: { value: "FTC practice" } }),
        ],
      }),
    ];

    expect(
      deriveMemoryRelations(robot, candidates).filter(
        ({ relationType }) => relationType === "same_activity",
      ),
    ).toEqual([
      expect.objectContaining({
        sourceMemoryId: "current",
        targetMemoryId: "robot",
      }),
    ]);
    expect(
      deriveMemoryRelations(ftc, candidates).filter(
        ({ relationType }) => relationType === "same_activity",
      ),
    ).toEqual([
      expect.objectContaining({
        sourceMemoryId: "current",
        targetMemoryId: "ftc",
      }),
    ]);
  });
});
