import { describe, expect, it } from "vitest";

import {
  normalizeSearchFeedbackQuery,
  searchFeedbackQueryHash,
} from "@/src/server/services/search-feedback";

describe("search feedback privacy key", () => {
  it("normalizes width, whitespace, and case before learning", () => {
    expect(normalizeSearchFeedbackQuery("  ＦＴＣ  の\n練習  ")).toBe(
      "ftc の 練習",
    );
  });

  it("creates a stable SHA-256 lookup without using raw text as a key", () => {
    const normalized = normalizeSearchFeedbackQuery("神山 FTC");
    expect(searchFeedbackQueryHash(normalized)).toMatch(/^[0-9a-f]{64}$/u);
    expect(searchFeedbackQueryHash(normalized)).toBe(
      searchFeedbackQueryHash("神山 ftc"),
    );
  });
});
