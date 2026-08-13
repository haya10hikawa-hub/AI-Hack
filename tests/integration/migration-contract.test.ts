import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/202608130001_initial_rememory.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(migrationPath, "utf8");

const privateTables = [
  "profiles",
  "user_preferences",
  "media_assets",
  "media_sequences",
  "sequence_assets",
  "events",
  "evidence",
  "memories",
  "ai_runs",
  "claims",
  "user_corrections",
  "claim_evidence",
  "memory_context_dimensions",
  "memory_gaps",
  "memory_relations",
  "personal_context",
] as const;

describe("baseline migration security contract", () => {
  it.each(privateTables)("enables RLS for %s", (table) => {
    expect(sql).toMatch(
      new RegExp(
        `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
        "iu",
      ),
    );
  });

  it("keeps all domain writes behind server-only RPCs", () => {
    expect(sql).toMatch(
      /revoke all on all tables in schema public from anon, authenticated/iu,
    );
    expect(sql).not.toMatch(/grant (?:insert|delete) on public\./iu);
    expect(sql).toMatch(
      /create or replace function public\.create_evidence_backed_claim/iu,
    );
    expect(sql).toMatch(
      /create or replace function public\.apply_user_correction/iu,
    );
    expect(sql).toMatch(
      /create or replace function public\.apply_memory_gap_correction/iu,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_memory_gap_correction\([^)]+\) to service_role/iu,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.(?:create_evidence_backed_claim|apply_user_correction|apply_memory_gap_correction)[^;]+to authenticated/iu,
    );
  });

  it("uses a private owner-scoped storage bucket", () => {
    expect(sql).toMatch(/'rememory-private',\s*'rememory-private',\s*false/iu);
    expect(sql).toMatch(/create policy rememory_storage_select_own/iu);
    expect(sql).not.toMatch(
      /create policy rememory_storage_(?:insert|update|delete)_own/iu,
    );
    expect(sql).toMatch(/auth\.uid\(\)::text \|\| '\/assets\//u);
  });

  it("exposes only active supported grounded claims from active memories", () => {
    expect(sql).toMatch(
      /create view public\.eligible_grounded_claims[\s\S]*memory\.status = 'active'/iu,
    );
    expect(sql).toMatch(/claim\.status = 'active'/iu);
    expect(sql).toMatch(
      /claim\.origin = 'user'[\s\S]*claim\.confidence_band in \('medium','high'\)/iu,
    );
    expect(sql).toMatch(/claim\.confirmation_status <> 'disputed'/iu);
  });
});
