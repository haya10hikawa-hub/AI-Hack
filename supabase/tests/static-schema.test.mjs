import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const migrationDirectory = new URL("../migrations/", import.meta.url);
const migration = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationDirectory), "utf8"))
  .join("\n");

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
  "ai_rate_limits",
  "ai_daily_budgets",
  "ai_cost_reservations",
  "sequence_analysis_jobs",
  "search_feedback",
  "coarse_location_labels",
  "memory_map_cells",
  "memory_map_cell_memories",
  "canonical_places",
  "memory_places",
];

for (const table of privateTables) {
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security;`),
    `${table} must enable RLS`,
  );
}

for (const forbidden of [
  "exact_lat",
  "exact_lng",
  "raw_exif",
  "original_filename",
]) {
  assert.doesNotMatch(
    migration
      .replaceAll("exact_lat", "documented_exact_lat")
      .replaceAll("exact_lng", "documented_exact_lng"),
    new RegExp(`\\b${forbidden}\\s+(?:numeric|double|text|jsonb)`, "i"),
    `${forbidden} must not be a persisted column`,
  );
}

assert.match(
  migration,
  /origin <> 'ai' or confirmation_status <> 'user_confirmed'/,
);
assert.match(
  migration,
  /active AI\/deterministic claim requires valid supporting evidence/,
);
assert.match(migration, /create policy rememory_storage_select_own/);
assert.doesNotMatch(
  migration,
  /create policy rememory_storage_(?:insert|update|delete)_own/,
);
assert.match(migration, /unique \(memory_id, role\)/);
assert.match(migration, /unique \(memory_id, asset_id\)/);
assert.match(migration, /create unique index memory_relations_dedupe_idx/);
assert.match(migration, /source_memory_id::text < target_memory_id::text/);
assert.match(migration, /create table public\.canonical_places/);
assert.match(migration, /unique \(provider, provider_place_id\)/);
assert.match(migration, /source = 'user_selected'/);
assert.match(migration, /create policy canonical_places_owner_select/);
assert.match(
  migration,
  /grant select on table public\.canonical_places, public\.memory_places to authenticated/,
);
assert.doesNotMatch(
  migration.match(/create table public\.canonical_places[\s\S]*?\n\);/)?.[0] ??
    "",
  /\b(?:lat|lng|latitude|longitude)\s+(?:numeric|double|text)/i,
);
assert.match(migration, /create table public\.memory_map_cells/);
assert.match(migration, /cell_id text not null/);
assert.doesNotMatch(
  migration.match(/create table public\.memory_map_cells[\s\S]*?\n\);/)?.[0] ??
    "",
  /\b(?:latitude|longitude)\s+(?:numeric|double|text)/i,
);
assert.match(
  migration,
  /revoke all on function public\.reveal_memory_map_cell\(uuid,text\)[\s\S]*?to service_role/,
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.reveal_memory_map_cell[^;]+to authenticated/,
);
assert.match(
  migration,
  /grant select, insert, update, delete on all tables in schema public to service_role/,
);
assert.match(migration, /create table public\.sequence_analysis_jobs/);
assert.match(migration, /for update skip locked/);
assert.match(
  migration,
  /grant execute on function public\.claim_sequence_analysis_job\([^)]+\)\s+to service_role/,
);
assert.match(migration, /values \(\s*'rememory-private',[\s\S]*?false,/);
assert.match(
  migration,
  /create or replace function public\.apply_memory_gap_correction/,
);
assert.match(migration, /target_claim_id uuid/);
assert.match(migration, /candidate_value_json jsonb/);
assert.match(
  migration,
  /revoke all on all tables in schema public from anon, authenticated/,
);
assert.doesNotMatch(migration, /grant\s+[^;]*delete\s+on\s+public\.memories/i);
assert.doesNotMatch(
  migration,
  /grant\s+[^;]*(?:insert|delete)\s+on\s+public\.(?:evidence|claims|ai_runs)/i,
);
assert.match(
  migration,
  /grant execute on function public\.create_evidence_backed_claim\([^)]+\) to service_role/,
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.(?:create_evidence_backed_claim|apply_user_correction|apply_memory_gap_correction)[^;]+to authenticated/,
);

console.log(
  `Static schema checks passed (${privateTables.length} RLS tables).`,
);
