import { describe, expect, it } from "vitest";

import {
  coordinatesToMemoryMapCell,
  isAllowedMemoryMapCell,
  MEMORY_MAP_H3_RESOLUTION,
  progressMemoryMapState,
} from "@/src/domain/memory-map";
import { getResolution } from "h3-js";

describe("privacy-safe Memory Map cells", () => {
  it("converts exact coordinates directly to the single allowed H3 resolution", () => {
    const cellId = coordinatesToMemoryMapCell(35, 135);
    expect(isAllowedMemoryMapCell(cellId)).toBe(true);
    expect(getResolution(cellId)).toBe(MEMORY_MAP_H3_RESOLUTION);
  });

  it("rejects malformed cells and valid cells at another resolution", () => {
    expect(isAllowedMemoryMapCell("not-a-cell")).toBe(false);
    expect(isAllowedMemoryMapCell("892e6e82177ffff")).toBe(false);
  });

  it("rejects invalid exact coordinate inputs before conversion", () => {
    expect(() => coordinatesToMemoryMapCell(91, 135)).toThrow();
    expect(() => coordinatesToMemoryMapCell(35, Number.NaN)).toThrow();
  });

  it("allows only monotonic state progression", () => {
    expect(progressMemoryMapState("passed", "experienced")).toBe("experienced");
    expect(progressMemoryMapState("experienced", "memory")).toBe("memory");
    expect(progressMemoryMapState("memory", "passed")).toBe("memory");
    expect(progressMemoryMapState("experienced", "passed")).toBe("experienced");
  });
});
