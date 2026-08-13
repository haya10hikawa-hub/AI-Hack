import { describe, expect, it } from "vitest";

import {
  assessContextCompleteness,
  assessMemoryImportance,
  evaluateMemoryGapGate,
} from "@/src/domain/memory-assessment";
import {
  clusterTemporalSequences,
  selectRepresentativeAssets,
  type SequenceAsset,
} from "@/src/domain/sequence";

function asset(
  id: string,
  capturedAtLocal: string,
  place = "place-a",
): SequenceAsset {
  return {
    id,
    capturedAt: `${capturedAtLocal}+09:00`,
    capturedAtLocal,
    coarseLocationKey: place,
    sha256: id.padEnd(64, "a").slice(0, 64),
    perceptualGroup: null,
    width: 1200,
    height: 800,
    sharpness: 0.8,
    exposureQuality: 0.8,
    visualQuality: 0.8,
    isScreenshot: false,
  };
}

describe("deterministic temporal sequences", () => {
  it("splits at a local date boundary even when the gap is short", () => {
    const sequences = clusterTemporalSequences([
      asset("a", "2026-04-12T23:55:00"),
      asset("b", "2026-04-13T00:05:00"),
    ]);
    expect(sequences).toHaveLength(2);
    expect(sequences[1]?.boundaryReason).toBe("local_date");
  });

  it("splits a gap greater than six hours and a coarse-place change", () => {
    expect(
      clusterTemporalSequences([
        asset("a", "2026-04-12T09:00:00"),
        asset("b", "2026-04-12T15:00:01"),
      ]),
    ).toHaveLength(2);
    expect(
      clusterTemporalSequences([
        asset("a", "2026-04-12T09:00:00", "one"),
        asset("b", "2026-04-12T09:10:00", "two"),
      ]),
    ).toHaveLength(2);
  });

  it("keeps one explicit upload batch together when every EXIF time is missing", () => {
    const missingTimeAssets = Array.from({ length: 10 }, (_, index) => ({
      ...asset(`missing-${index}`, "2026-04-12T09:00:00"),
      capturedAt: null,
      capturedAtLocal: null,
      sha256: String(index).padStart(64, "0"),
    }));

    expect(clusterTemporalSequences(missingTimeAssets)).toHaveLength(10);
    const uploadBatch = clusterTemporalSequences(missingTimeAssets, {
      groupMissingTimeInSameBatch: true,
    });
    expect(uploadBatch).toHaveLength(1);
    expect(uploadBatch[0]).toMatchObject({
      assetIds: missingTimeAssets.map(({ id }) => id),
      startedAt: null,
      endedAt: null,
    });
  });

  it("selects at most three representatives and collapses duplicate hashes", () => {
    const duplicate = {
      ...asset("c", "2026-04-12T10:00:00"),
      sha256: asset("a", "2026-04-12T09:00:00").sha256,
    };
    const selected = selectRepresentativeAssets([
      asset("a", "2026-04-12T09:00:00"),
      asset("b", "2026-04-12T09:30:00"),
      duplicate,
      asset("d", "2026-04-12T11:00:00"),
    ]);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.map(({ assetId }) => assetId)).not.toEqual(
      expect.arrayContaining(["a", "c"]),
    );
  });
});

describe("memory assessment and conservative gap gate", () => {
  it("treats importance as explainable processing priority", () => {
    const result = assessMemoryImportance({
      photoCount: 10,
      sequenceDurationMinutes: 40,
      unusualLocation: false,
      temporalDensity: 1,
      visualChange: 0,
      relatedConfirmedMemories: 0,
      repeatedUserInteractions: 0,
      aiContextSignal: null,
    });
    expect(result.band).toBe("medium");
    expect(result.reasons.map(({ signal }) => signal)).toContain("photo_count");
  });

  it("asks only a sufficiently narrow, evidence-worthy missing question", () => {
    const completeness = assessContextCompleteness([
      {
        dimension: "time",
        status: "known",
        importanceWeight: 3,
        activeClaimId: "time",
      },
      {
        dimension: "purpose",
        status: "missing",
        importanceWeight: 3,
        activeClaimId: null,
      },
    ]);
    const decision = evaluateMemoryGapGate({
      importance: "medium",
      completeness,
      candidates: [
        {
          id: "gap",
          dimension: "purpose",
          gapType: "purpose",
          question: "これはFTCの練習でしたか？",
          options: [
            { label: "そう", value: "ftc_practice" },
            { label: "違う", value: "other" },
          ],
          confidenceBand: "high",
          candidateSpecificity: 0.8,
          askedCount: 0,
          status: "detected",
        },
      ],
    });
    expect(decision.ready).toBe(true);
  });

  it("does not ask low-importance or ambiguous questions", () => {
    const completeness = assessContextCompleteness([
      {
        dimension: "purpose",
        status: "missing",
        importanceWeight: 3,
        activeClaimId: null,
      },
    ]);
    expect(
      evaluateMemoryGapGate({ importance: "low", completeness, candidates: [] })
        .ready,
    ).toBe(false);
    expect(
      evaluateMemoryGapGate({
        importance: "medium",
        completeness,
        candidates: [
          {
            id: "vague",
            dimension: "purpose",
            gapType: "purpose",
            question: "何をしていましたか？",
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
            ],
            confidenceBand: "medium",
            candidateSpecificity: 0.2,
            askedCount: 0,
            status: "detected",
          },
        ],
      }).ready,
    ).toBe(false);
  });
});
