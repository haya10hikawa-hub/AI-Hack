import "server-only";

import { createHash } from "node:crypto";

export function normalizeSearchFeedbackQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function searchFeedbackQueryHash(normalizedQuery: string): string {
  return createHash("sha256").update(normalizedQuery, "utf8").digest("hex");
}
