import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(
  new URL("../../supabase/migrations/", import.meta.url),
);
const sql = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${migrationDirectory}/${name}`, "utf8"))
  .join("\n");
const checkpointMigration = readFileSync(
  `${migrationDirectory}/202608140004_analysis_job_checkpoints.sql`,
  "utf8",
);

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
  "sequence_analysis_jobs",
  "search_feedback",
  "coarse_location_labels",
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
    expect(sql).toMatch(
      /grant select, insert, update, delete on all tables in schema public to service_role/iu,
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

  it("keeps durable analysis jobs service-only and lease based", () => {
    expect(sql).toMatch(/create table public\.sequence_analysis_jobs/iu);
    expect(sql).toMatch(/for update skip locked/iu);
    expect(sql).toMatch(
      /insert into public\.sequence_analysis_jobs[\s\S]*sequence\.analysis_status in \('pending','processing','failed'\)/iu,
    );
    expect(sql).toMatch(
      /create or replace function public\.enqueue_sequence_analysis_job/iu,
    );
    expect(sql).toMatch(
      /create or replace function public\.claim_sequence_analysis_job/iu,
    );
    expect(sql).toMatch(
      /create or replace function public\.touch_sequence_analysis_job/iu,
    );
    expect(sql).toMatch(
      /create or replace function public\.finish_sequence_analysis_job/iu,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_sequence_analysis_job\([^)]+\)\s+to service_role/iu,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.(?:enqueue|claim|touch|finish)_sequence_analysis_job[^;]+to authenticated/iu,
    );
  });

  it("preserves the earliest unfinished AI stage across retry and reclaim", () => {
    expect(checkpointMigration).toMatch(
      /when analysis_job\.stage in \('claims','gap'\) then analysis_job\.stage[\s\S]*else 'analysis'/iu,
    );
    expect(checkpointMigration).toMatch(
      /elsif v_job\.attempt_count < v_job\.max_attempts then[\s\S]*set status = 'retry_wait',[\s\S]*available_at/iu,
    );
    expect(checkpointMigration).not.toMatch(
      /set status = 'retry_wait',\s*stage = 'queued'/iu,
    );
    expect(checkpointMigration).toMatch(
      /when sequence_analysis_jobs\.stage in \('analysis','claims','gap'\)[\s\S]*then sequence_analysis_jobs\.stage/iu,
    );
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

  it("keeps opt-in search feedback owner scoped and removable", () => {
    expect(sql).toMatch(/create table public\.search_feedback/iu);
    expect(sql).toMatch(/outcome in \('helpful', 'not_helpful'\)/iu);
    expect(sql).toMatch(/create policy search_feedback_select_own/iu);
    expect(sql).toMatch(
      /revoke all on table public\.search_feedback from anon, authenticated/iu,
    );
    expect(sql).toMatch(
      /foreign key \(memory_id, user_id\)[\s\S]*references public\.memories\(id, user_id\) on delete cascade/iu,
    );
  });

  it("caches only coarse public locality labels service-side", () => {
    expect(sql).toMatch(/create table public\.coarse_location_labels/iu);
    expect(sql).toMatch(/grid_key text primary key/iu);
    expect(sql).toMatch(
      /revoke all on table public\.coarse_location_labels from anon, authenticated/iu,
    );
    expect(sql).not.toMatch(
      /create table public\.coarse_location_labels[\s\S]*?(?:latitude|longitude)\s+(?:numeric|double|text)/iu,
    );
  });
});
