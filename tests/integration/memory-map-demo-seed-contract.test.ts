import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "scripts/seed-memory-map-demo.mjs"),
  "utf8",
);

describe("local Memory Map demo seed contract", () => {
  it("refuses hosted Supabase and targets only the fixed local demo account", () => {
    expect(source).toMatch(/127\.0\.0\.1:54321/u);
    expect(source).toMatch(/localhost:54321/u);
    expect(source).toMatch(/Refusing to seed/u);
    expect(source).toMatch(/memory-map-demo@local\.rememory\.test/u);
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL/u);
  });

  it("creates the required real-schema state mix without exact coordinates", () => {
    expect(source).toMatch(/state: "passed"/u);
    expect(source).toMatch(/state: "experienced"/u);
    expect(source.match(/memory_map_cell_memories/g)).toHaveLength(1);
    expect(source).toMatch(/claim_evidence/u);
    expect(source).toMatch(/evidence/u);
    expect(source).not.toMatch(/latitude|longitude|GPS path/iu);
  });
});
