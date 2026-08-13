import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const migration = source(
  "supabase/migrations/202608130001_initial_rememory.sql",
);
const listRoute = source("app/api/gaps/route.ts");
const confirmRoute = source("app/api/gaps/[id]/confirm/route.ts");
const memoriesService = source("src/server/services/memories.ts");

describe("deferred Memory gap contract", () => {
  it("persists a due timestamp whenever a gap is deferred", () => {
    expect(migration).toMatch(/deferred_until\s+timestamptz/iu);
    expect(migration).toMatch(
      /status\s*<>\s*'deferred'\s+or\s+deferred_until\s+is\s+not\s+null/iu,
    );
    expect(confirmRoute).toContain("Date.now() + 24 * 60 * 60 * 1_000");
    expect(confirmRoute).toMatch(
      /update\(\{\s*status:\s*"deferred",\s*deferred_until:\s*deferredUntil\s*\}\)/u,
    );
    expect(confirmRoute).toContain(
      '.in("status", ["detected", "ready_to_ask", "deferred"])',
    );
    expect(confirmRoute).toContain('.select("deferred_until")');
    expect(confirmRoute).toContain("GAP_NOT_ANSWERABLE");
  });

  it("shows only immediately-ready or due deferred gaps", () => {
    const dueFilter =
      "status.eq.ready_to_ask,and(status.eq.deferred,deferred_until.lte.${now})";
    expect(listRoute).toContain(dueFilter);
    expect(memoriesService).toContain(dueFilter);
  });

  it("displays the exact bound candidate before an option fallback", () => {
    expect(listRoute).toContain("candidate_value_json");
    expect(listRoute).toMatch(
      /candidateLabel:\s*\n?\s*candidateText\(gap\.candidate_value_json\)\s*\?\?\s*\n?\s*firstText\(gap\.options_json,\s*"label"\)/u,
    );
    expect(listRoute).toMatch(
      /for \(const key of \[[\s\S]*?"value",[\s\S]*?"purpose",[\s\S]*?\] as const\)/u,
    );
  });
});
