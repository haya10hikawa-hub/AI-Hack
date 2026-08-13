-- Re:Memory MVP schema, ownership boundary, provenance invariants, and private storage.
-- PostgreSQL 15 / Supabase. This migration intentionally contains no demo user data.

create extension if not exists pgcrypto with schema extensions;

-- Keep trigger functions out of the API-exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$function$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  use_photos boolean not null default true,
  use_captured_at boolean not null default true,
  use_location boolean not null default false,
  use_calendar boolean not null default false,
  use_people boolean not null default false,
  use_personal_context boolean not null default true,
  search_learning_enabled boolean not null default false,
  confirmation_timing text not null default 'on_app_open'
    check (confirmation_timing in ('after_event','evening','next_day','on_app_open','off')),
  preferred_confirmation_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('image','video')),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime')),
  storage_key text not null,
  derivative_storage_key text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes > 0 and bytes <= 20971520),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  captured_at timestamptz,
  timezone_offset text check (timezone_offset is null or timezone_offset ~ '^[+-](0[0-9]|1[0-4]):[0-5][0-9]$'),
  coarse_place text check (coarse_place is null or char_length(coarse_place) <= 240),
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','processing','complete','failed')),
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending','processing','complete','failed','not_supported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sha256),
  unique (storage_key),
  unique (id, user_id),
  check (derivative_storage_key is null or derivative_storage_key <> storage_key),
  check (position('/' in storage_key) > 0)
);

create table public.media_sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz,
  ended_at timestamptz,
  coarse_place text check (coarse_place is null or char_length(coarse_place) <= 240),
  status text not null default 'provisional' check (status in ('provisional','active','deleted')),
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending','processing','complete','failed','not_supported')),
  analysis_lease_until timestamptz,
  analysis_attempt_count integer not null default 0 check (analysis_attempt_count between 0 and 20),
  cluster_version text not null default 'v1' check (char_length(cluster_version) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (started_at is null or ended_at is null or ended_at >= started_at),
  check ((analysis_status = 'processing' and analysis_lease_until is not null)
      or (analysis_status <> 'processing' and analysis_lease_until is null))
);

create table public.sequence_assets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  sequence_id uuid not null,
  asset_id uuid not null,
  position integer not null default 0 check (position >= 0),
  is_representative boolean not null default false,
  reason text check (reason is null or char_length(reason) <= 500),
  primary key (sequence_id, asset_id),
  foreign key (sequence_id, user_id) references public.media_sequences(id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references public.media_assets(id, user_id) on delete cascade
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sequence_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  coarse_place text check (coarse_place is null or char_length(coarse_place) <= 240),
  title_candidate text check (title_candidate is null or char_length(title_candidate) <= 240),
  status text not null default 'provisional' check (status in ('provisional','active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (sequence_id, user_id) references public.media_sequences(id, user_id) on delete set null (sequence_id),
  check (started_at is null or ended_at is null or ended_at >= started_at)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid,
  asset_id uuid,
  kind text not null check (char_length(kind) between 1 and 80),
  field text not null check (char_length(field) between 1 and 80),
  value_json jsonb not null,
  source_type text not null check (source_type in ('metadata','ai_observation','user_statement','calendar','location','system')),
  source_version text check (source_version is null or char_length(source_version) <= 80),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  observed_at timestamptz,
  validity text not null default 'valid' check (validity in ('valid','uncertain','invalid','deleted')),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, dedupe_key),
  foreign key (event_id, user_id) references public.events(id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references public.media_assets(id, user_id) on delete cascade,
  check (event_id is not null or asset_id is not null)
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  summary text check (summary is null or char_length(summary) <= 5000),
  status text not null default 'draft' check (status in ('draft','active','disputed','deleting','deleted')),
  importance_band text not null default 'low' check (importance_band in ('low','medium','high')),
  importance_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(importance_reasons) = 'array'),
  visibility text not null default 'private' check (visibility = 'private'),
  share_status text not null default 'none' check (share_status = 'none'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id),
  unique (id, user_id),
  foreign key (event_id, user_id) references public.events(id, user_id) on delete cascade
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (char_length(purpose) between 1 and 80),
  model text not null check (char_length(model) between 1 and 160),
  provider text check (provider is null or char_length(provider) <= 80),
  prompt_version text check (prompt_version is null or char_length(prompt_version) <= 80),
  schema_version text check (schema_version is null or char_length(schema_version) <= 80),
  input_assets integer not null default 0 check (input_assets between 0 and 20),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  cost_usd_estimate numeric(12,6) check (cost_usd_estimate is null or cost_usd_estimate >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  retry_count integer not null default 0 check (retry_count between 0 and 10),
  status text not null check (status in ('success','failed','timeout','rate_limited','invalid_output')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  field text not null check (char_length(field) between 1 and 80),
  value_json jsonb not null,
  origin text not null check (origin in ('deterministic','ai','user')),
  confidence_band text not null default 'low' check (confidence_band in ('low','medium','high','unsupported')),
  confirmation_status text not null default 'unconfirmed' check (confirmation_status in ('unconfirmed','user_confirmed','disputed')),
  status text not null default 'generated' check (status in ('generated','active','superseded','rejected','disputed','unsupported','deleted')),
  ai_run_id uuid,
  source_correction_id uuid,
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, memory_id, user_id),
  foreign key (memory_id, user_id) references public.memories(id, user_id) on delete cascade,
  foreign key (ai_run_id, user_id) references public.ai_runs(id, user_id) on delete set null (ai_run_id),
  check (origin <> 'ai' or confirmation_status <> 'user_confirmed'),
  check (confirmation_status <> 'user_confirmed' or origin = 'user'),
  check (status <> 'active' or (confidence_band <> 'unsupported' and confirmation_status <> 'disputed')),
  check (status <> 'unsupported' or confidence_band = 'unsupported'),
  check (origin = 'user' or source_correction_id is null),
  check (origin = 'ai' or ai_run_id is null)
);

create unique index claims_user_dedupe_idx
  on public.claims(user_id, dedupe_key)
  where dedupe_key is not null;

create table public.user_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  target_claim_id uuid,
  created_claim_id uuid,
  action text not null check (action in ('confirm','replace','reject','resolve')),
  value_json jsonb,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, memory_id, user_id),
  unique (user_id, idempotency_key),
  unique (created_claim_id),
  foreign key (memory_id, user_id) references public.memories(id, user_id) on delete cascade,
  foreign key (target_claim_id, memory_id, user_id)
    references public.claims(id, memory_id, user_id) deferrable initially deferred,
  check (action <> 'reject' or created_claim_id is null)
);

alter table public.claims
  add constraint claims_source_correction_fk
  foreign key (source_correction_id, memory_id, user_id)
  references public.user_corrections(id, memory_id, user_id)
  deferrable initially deferred;

alter table public.user_corrections
  add constraint corrections_created_claim_fk
  foreign key (created_claim_id, memory_id, user_id)
  references public.claims(id, memory_id, user_id)
  deferrable initially deferred;

create unique index claims_source_correction_idx
  on public.claims(source_correction_id)
  where source_correction_id is not null;

create table public.claim_evidence (
  user_id uuid not null references public.profiles(id) on delete cascade,
  claim_id uuid not null,
  evidence_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (claim_id, evidence_id),
  foreign key (claim_id, user_id) references public.claims(id, user_id) on delete cascade,
  foreign key (evidence_id, user_id) references public.evidence(id, user_id) on delete cascade
);

create table public.memory_context_dimensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  dimension text not null check (dimension in ('time','location','activity','purpose','people','result','meaning')),
  status text not null check (status in ('known','missing','unknown','not_applicable')),
  active_claim_id uuid,
  importance_weight smallint not null default 1 check (importance_weight between 0 and 10),
  updated_at timestamptz not null default now(),
  unique (memory_id, dimension),
  unique (id, user_id),
  foreign key (memory_id, user_id) references public.memories(id, user_id) on delete cascade,
  foreign key (active_claim_id, memory_id, user_id)
    references public.claims(id, memory_id, user_id) deferrable initially deferred
);

create table public.memory_gaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  target_claim_id uuid,
  dimension text check (dimension is null or dimension in ('time','location','activity','purpose','people','result','meaning')),
  gap_type text not null check (gap_type in ('purpose','event_type','result','people','context')),
  question text check (question is null or char_length(question) <= 500),
  options_json jsonb check (options_json is null or jsonb_typeof(options_json) = 'array'),
  candidate_value_json jsonb,
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  confidence_band text not null default 'low' check (confidence_band in ('low','medium','high')),
  reason_json jsonb not null default '{}'::jsonb check (jsonb_typeof(reason_json) = 'object'),
  status text not null default 'detected' check (status in ('detected','ready_to_ask','deferred','resolved','skipped','dismissed')),
  asked_count integer not null default 0 check (asked_count between 0 and 3),
  created_at timestamptz not null default now(),
  deferred_until timestamptz,
  resolved_at timestamptz,
  unique (id, user_id),
  unique (user_id, dedupe_key),
  foreign key (memory_id, user_id) references public.memories(id, user_id) on delete cascade,
  foreign key (target_claim_id, memory_id, user_id)
    references public.claims(id, memory_id, user_id) on delete set null (target_claim_id),
  check (status <> 'ready_to_ask' or (question is not null and confidence_band in ('medium','high'))),
  check (status <> 'deferred' or deferred_until is not null),
  check (status <> 'resolved' or resolved_at is not null)
);

create table public.memory_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_memory_id uuid not null,
  target_memory_id uuid not null,
  relation_type text not null check (char_length(relation_type) between 1 and 80),
  origin text not null check (origin in ('deterministic','ai','user')),
  confirmation_status text not null default 'unconfirmed' check (confirmation_status in ('unconfirmed','user_confirmed','disputed')),
  confidence_band text not null default 'low' check (confidence_band in ('low','medium','high')),
  reason_json jsonb not null default '{}'::jsonb check (jsonb_typeof(reason_json) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (source_memory_id, user_id) references public.memories(id, user_id) on delete cascade,
  foreign key (target_memory_id, user_id) references public.memories(id, user_id) on delete cascade,
  check (source_memory_id <> target_memory_id),
  check (origin <> 'ai' or confirmation_status <> 'user_confirmed'),
  check (confirmation_status <> 'user_confirmed' or origin = 'user')
);

create table public.personal_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  context_type text not null check (char_length(context_type) between 1 and 80),
  key text not null check (char_length(key) between 1 and 240),
  value_json jsonb not null,
  source_type text not null check (source_type in ('user_correction','user_confirmed_claim','repeated_feedback','import')),
  confirmation_status text not null default 'candidate' check (confirmation_status in ('candidate','user_confirmed','rejected')),
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, context_type, key)
);

-- Shared, race-safe AI gates. They contain counters and accounting only, never prompts or answers.
create table public.ai_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 160),
  window_started_at_ms bigint not null check (window_started_at_ms >= 0),
  expires_at_ms bigint not null check (expires_at_ms > window_started_at_ms),
  request_count bigint not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, key, window_started_at_ms)
);

create table public.ai_daily_budgets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key date not null,
  daily_limit_usd numeric(12,6) not null check (daily_limit_usd >= 0),
  reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0),
  committed_usd numeric(12,6) not null default 0 check (committed_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day_key),
  check (reserved_usd + committed_usd <= daily_limit_usd)
);

create table public.ai_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (char_length(purpose) between 1 and 80),
  day_key date not null,
  reserved_usd numeric(12,6) not null check (reserved_usd >= 0),
  actual_usd numeric(12,6) check (actual_usd is null or actual_usd >= 0),
  status text not null default 'reserved' check (status in ('reserved','committed','released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (id, user_id),
  foreign key (user_id, day_key) references public.ai_daily_budgets(user_id, day_key) on delete cascade,
  check ((status = 'reserved' and actual_usd is null and settled_at is null)
      or (status = 'committed' and actual_usd is not null and settled_at is not null)
      or (status = 'released' and actual_usd is null and settled_at is not null))
);

-- Relational and retrieval indexes. Partial indexes encode the "normal answer"
-- eligibility boundary so application queries can stay selective.
create index media_assets_user_captured_idx on public.media_assets(user_id, captured_at desc);
create index media_sequences_user_started_idx on public.media_sequences(user_id, started_at desc);
create index events_user_started_idx on public.events(user_id, started_at desc);
create unique index events_live_sequence_idx on public.events(sequence_id)
  where sequence_id is not null and status <> 'deleted';
create index evidence_event_idx on public.evidence(event_id);
create index evidence_asset_idx on public.evidence(asset_id);
create index evidence_user_field_idx on public.evidence(user_id, field) where validity = 'valid';
create index memories_user_updated_idx on public.memories(user_id, updated_at desc);
create index memories_user_status_idx on public.memories(user_id, status);
create index memories_retrievable_idx on public.memories(user_id, updated_at desc)
  where status = 'active';
create index memories_search_idx on public.memories
  using gin (to_tsvector('simple', title || ' ' || coalesce(summary, '')))
  where status = 'active';
create index claims_memory_status_idx on public.claims(memory_id, status);
create index claims_user_field_idx on public.claims(user_id, field);
create index claims_retrievable_idx on public.claims(memory_id, field)
  where status = 'active' and confidence_band <> 'unsupported' and confirmation_status <> 'disputed';
create index claims_value_idx on public.claims using gin (value_json jsonb_path_ops);
create index claim_evidence_evidence_idx on public.claim_evidence(evidence_id);
create index memory_gaps_ready_idx
  on public.memory_gaps(user_id, status, deferred_until, created_at);
create index relations_source_idx on public.memory_relations(source_memory_id);
create index relations_target_idx on public.memory_relations(target_memory_id);
create index personal_context_lookup_idx on public.personal_context(user_id, context_type, key);
create index ai_runs_user_created_idx on public.ai_runs(user_id, created_at desc);
create index ai_rate_limits_expiry_idx on public.ai_rate_limits(expires_at_ms);
create index ai_cost_reservations_user_created_idx on public.ai_cost_reservations(user_id, created_at desc);

-- Do not permit exact coordinates to be smuggled into generic JSON fields.
create or replace function private.contains_exact_location(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $function$
declare
  v_key text;
  v_child jsonb;
  v_normalized_key text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      for v_key, v_child in select key, value from jsonb_each(p_value)
      loop
        v_normalized_key := lower(regexp_replace(v_key, '[ -]+', '_', 'g'));
        if v_normalized_key in (
          'lat','lng','lon','latitude','longitude','gps','gps_latitude','gps_longitude',
          'exact_lat','exact_lng','exact_location','coordinates'
        ) then
          return true;
        end if;
        if private.contains_exact_location(v_child) then
          return true;
        end if;
      end loop;
    when 'array' then
      for v_child in select value from jsonb_array_elements(p_value)
      loop
        if private.contains_exact_location(v_child) then
          return true;
        end if;
      end loop;
    else
      null;
  end case;
  return false;
end;
$function$;

create or replace function private.reject_exact_location_json()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $function$
begin
  if private.contains_exact_location(new.value_json) then
    raise exception 'exact location fields are not allowed in %', tg_table_name
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger evidence_reject_exact_location
before insert or update of value_json on public.evidence
for each row execute function private.reject_exact_location_json();
create trigger claims_reject_exact_location
before insert or update of value_json on public.claims
for each row execute function private.reject_exact_location_json();
create trigger personal_context_reject_exact_location
before insert or update of value_json on public.personal_context
for each row execute function private.reject_exact_location_json();

create or replace function private.reject_gap_exact_location_json()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $function$
begin
  if new.candidate_value_json is not null
     and private.contains_exact_location(new.candidate_value_json) then
    raise exception 'exact location fields are not allowed in memory gaps'
      using errcode = '22023';
  end if;
  if new.options_json is not null and private.contains_exact_location(new.options_json) then
    raise exception 'exact location fields are not allowed in memory gap options'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger memory_gaps_reject_exact_location
before insert or update of candidate_value_json, options_json on public.memory_gaps
for each row execute function private.reject_gap_exact_location_json();

create trigger corrections_reject_exact_location
before insert or update of value_json on public.user_corrections
for each row execute function private.reject_exact_location_json();

create or replace function private.prevent_correction_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' or pg_trigger_depth() <= 1 then
    raise exception 'user corrections are append-only' using errcode = '55000';
  end if;
  return old;
end;
$function$;

create trigger corrections_append_only_update
before update on public.user_corrections
for each row execute function private.prevent_correction_mutation();
create trigger corrections_append_only_delete
before delete on public.user_corrections
for each row execute function private.prevent_correction_mutation();

-- Storage keys are canonical and tied to the database owner and asset ID.
create or replace function private.validate_asset_storage_keys()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  v_prefix text := new.user_id::text || '/assets/' || new.id::text || '/';
begin
  if new.storage_key <> v_prefix || 'original' then
    raise exception 'invalid original storage path' using errcode = '22023';
  end if;
  if new.derivative_storage_key is not null
     and new.derivative_storage_key <> v_prefix || 'vision.webp' then
    raise exception 'invalid derivative storage path' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger media_assets_validate_storage_keys
before insert or update of id, user_id, storage_key, derivative_storage_key on public.media_assets
for each row execute function private.validate_asset_storage_keys();

-- A source image must actually belong to the sequence interpreted as its event.
create or replace function private.validate_evidence_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_sequence_id uuid;
begin
  if new.event_id is null or new.asset_id is null then
    return new;
  end if;
  select sequence_id into v_sequence_id
  from public.events
  where id = new.event_id and user_id = new.user_id;

  if v_sequence_id is not null and not exists (
    select 1 from public.sequence_assets sa
    where sa.user_id = new.user_id
      and sa.sequence_id = v_sequence_id
      and sa.asset_id = new.asset_id
  ) then
    raise exception 'evidence asset does not belong to the event sequence'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger evidence_validate_membership
before insert or update of user_id, event_id, asset_id on public.evidence
for each row execute function private.validate_evidence_membership();

-- Prevent an asset from being in more than one non-deleted temporal sequence.
-- Advisory locks close the concurrency race that a cross-table CHECK cannot.
create or replace function private.enforce_single_live_sequence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.asset_id::text, 0));
  if exists (
    select 1
    from public.sequence_assets other
    join public.media_sequences sequence on sequence.id = other.sequence_id
    where other.asset_id = new.asset_id
      and other.sequence_id <> new.sequence_id
      and sequence.status <> 'deleted'
  ) and exists (
    select 1 from public.media_sequences sequence
    where sequence.id = new.sequence_id and sequence.status <> 'deleted'
  ) then
    raise exception 'asset already belongs to another live sequence'
      using errcode = '23505';
  end if;
  return new;
end;
$function$;

create trigger sequence_assets_single_live_sequence
before insert or update of sequence_id, asset_id on public.sequence_assets
for each row execute function private.enforce_single_live_sequence();

create or replace function private.enforce_sequence_reactivation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_asset_id uuid;
begin
  if old.status = 'deleted' and new.status <> 'deleted' then
    for v_asset_id in
      select asset_id from public.sequence_assets where sequence_id = new.id order by asset_id
    loop
      perform pg_advisory_xact_lock(hashtextextended(v_asset_id::text, 0));
      if exists (
        select 1 from public.sequence_assets sa
        join public.media_sequences ms on ms.id = sa.sequence_id
        where sa.asset_id = v_asset_id and sa.sequence_id <> new.id and ms.status <> 'deleted'
      ) then
        raise exception 'cannot reactivate sequence: an asset belongs to another live sequence'
          using errcode = '23505';
      end if;
    end loop;
  end if;
  return new;
end;
$function$;

create trigger media_sequences_safe_reactivation
before update of status on public.media_sequences
for each row execute function private.enforce_sequence_reactivation();

create or replace function private.evidence_belongs_to_memory(
  p_evidence_id uuid,
  p_memory_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.evidence evidence
    join public.memories memory
      on memory.id = p_memory_id and memory.user_id = p_user_id
    join public.events event on event.id = memory.event_id and event.user_id = p_user_id
    where evidence.id = p_evidence_id
      and evidence.user_id = p_user_id
      and evidence.validity = 'valid'
      and (
        evidence.event_id = memory.event_id
        or (
          evidence.asset_id is not null
          and event.sequence_id is not null
          and exists (
            select 1 from public.sequence_assets sa
            where sa.user_id = p_user_id
              and sa.sequence_id = event.sequence_id
              and sa.asset_id = evidence.asset_id
          )
        )
      )
  );
$function$;

create or replace function private.validate_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_claim public.claims%rowtype;
begin
  select * into v_claim from public.claims where id = p_claim_id;
  if not found then
    return;
  end if;

  if v_claim.origin = 'ai' and v_claim.confirmation_status = 'user_confirmed' then
    raise exception 'AI claims cannot be user-confirmed in place' using errcode = '23514';
  end if;

  if v_claim.origin = 'user' then
    if v_claim.source_correction_id is null then
      raise exception 'user claims require correction provenance' using errcode = '23514';
    end if;
    if v_claim.confirmation_status not in ('user_confirmed','disputed') then
      raise exception 'user claims must be confirmed or disputed' using errcode = '23514';
    end if;
  end if;

  if v_claim.status = 'active' and v_claim.origin in ('ai','deterministic') then
    if not exists (
      select 1 from public.claim_evidence link
      where link.claim_id = v_claim.id
        and link.user_id = v_claim.user_id
        and private.evidence_belongs_to_memory(link.evidence_id, v_claim.memory_id, v_claim.user_id)
    ) then
      raise exception 'active AI/deterministic claim requires valid supporting evidence'
        using errcode = '23514';
    end if;
  end if;

  if v_claim.status = 'active' and v_claim.origin = 'user' and not exists (
    select 1 from public.user_corrections correction
    where correction.id = v_claim.source_correction_id
      and correction.user_id = v_claim.user_id
      and correction.memory_id = v_claim.memory_id
      and correction.created_claim_id = v_claim.id
  ) then
    raise exception 'active user claim must round-trip to its immutable correction'
      using errcode = '23514';
  end if;
end;
$function$;

create or replace function private.claim_constraint_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  perform private.validate_claim(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$function$;

create constraint trigger claims_validate_provenance
after insert or update on public.claims
deferrable initially deferred
for each row execute function private.claim_constraint_trigger();

create or replace function private.claim_evidence_constraint_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  perform private.validate_claim(coalesce(new.claim_id, old.claim_id));
  return coalesce(new, old);
end;
$function$;

create constraint trigger claim_evidence_validate_provenance
after insert or update or delete on public.claim_evidence
deferrable initially deferred
for each row execute function private.claim_evidence_constraint_trigger();

create or replace function private.prevent_direct_memory_delete_state()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if current_user = 'authenticated'
     and ((old.status not in ('deleting','deleted') and new.status in ('deleting','deleted'))
       or (old.status in ('deleting','deleted') and new.status not in ('deleting','deleted'))) then
    raise exception 'use the memory deletion transaction for deletion state transitions'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger memories_guard_delete_state
before update of status on public.memories
for each row execute function private.prevent_direct_memory_delete_state();

-- updated_at is database-owned; clients cannot spoof it.
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger preferences_set_updated_at before update on public.user_preferences
for each row execute function private.set_updated_at();
create trigger media_assets_set_updated_at before update on public.media_assets
for each row execute function private.set_updated_at();
create trigger media_sequences_set_updated_at before update on public.media_sequences
for each row execute function private.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function private.set_updated_at();
create trigger memories_set_updated_at before update on public.memories
for each row execute function private.set_updated_at();
create trigger claims_set_updated_at before update on public.claims
for each row execute function private.set_updated_at();
create trigger context_dimensions_set_updated_at before update on public.memory_context_dimensions
for each row execute function private.set_updated_at();
create trigger memory_relations_set_updated_at before update on public.memory_relations
for each row execute function private.set_updated_at();
create trigger personal_context_set_updated_at before update on public.personal_context
for each row execute function private.set_updated_at();
create trigger ai_rate_limits_set_updated_at before update on public.ai_rate_limits
for each row execute function private.set_updated_at();
create trigger ai_daily_budgets_set_updated_at before update on public.ai_daily_budgets
for each row execute function private.set_updated_at();

-- Auth provisioning is idempotent: every auth user receives exactly one profile
-- and one preference row. Only an explicitly supplied display name is copied.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_display_name text;
begin
  v_display_name := left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 120);
  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill accounts that predate this migration using the same minimized fields.
insert into public.profiles (id, display_name)
select id, left(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''), 120)
from auth.users
on conflict (id) do nothing;
insert into public.user_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- CAS lease for retry-safe sequence analysis. Only the exact persisted
-- representative set may claim a lease, and active leases/complete work win.
create or replace function public.claim_sequence_analysis(
  p_user_id uuid,
  p_sequence_id uuid,
  p_asset_ids uuid[],
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_expected uuid[];
  v_requested uuid[];
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) = 0
     or p_lease_seconds not between 30 and 1800 then
    raise exception 'invalid analysis lease request' using errcode = '22023';
  end if;
  select coalesce(array_agg(asset_id order by asset_id), '{}'::uuid[]) into v_expected
  from public.sequence_assets
  where user_id = p_user_id and sequence_id = p_sequence_id and is_representative;
  select coalesce(array_agg(item order by item), '{}'::uuid[]) into v_requested
  from (select distinct item from unnest(p_asset_ids) item where item is not null) requested;
  if v_expected = '{}'::uuid[] or v_requested <> v_expected then
    raise exception 'asset set must exactly match the sequence representatives'
      using errcode = '23514';
  end if;

  update public.media_sequences
  set analysis_status = 'processing',
      analysis_lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      analysis_attempt_count = analysis_attempt_count + 1
  where id = p_sequence_id and user_id = p_user_id and status <> 'deleted'
    and analysis_attempt_count < 20
    and (
      analysis_status in ('pending','failed')
      or (analysis_status = 'processing' and analysis_lease_until < clock_timestamp())
    );
  if not found then
    return false;
  end if;
  update public.media_assets
  set analysis_status = 'processing'
  where user_id = p_user_id and id = any(v_requested)
    and analysis_status <> 'complete';
  return true;
end;
$function$;

create or replace function public.complete_sequence_analysis(
  p_user_id uuid,
  p_sequence_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_status not in ('complete','failed','not_supported') then
    raise exception 'invalid terminal analysis status' using errcode = '22023';
  end if;
  update public.media_sequences
  set analysis_status = p_status, analysis_lease_until = null
  where id = p_sequence_id and user_id = p_user_id
    and analysis_status = 'processing';
  if not found then
    return exists (
      select 1 from public.media_sequences
      where id = p_sequence_id and user_id = p_user_id and analysis_status = p_status
    );
  end if;
  update public.media_assets asset
  set analysis_status = p_status
  where asset.user_id = p_user_id
    and exists (
      select 1 from public.sequence_assets link
      where link.user_id = p_user_id and link.sequence_id = p_sequence_id
        and link.asset_id = asset.id
    );
  return true;
end;
$function$;

-- Server-only transaction for deterministic/AI claims. The caller must derive
-- p_user_id from a freshly authenticated user, never from request input.
create or replace function public.create_evidence_backed_claim(
  p_user_id uuid,
  p_memory_id uuid,
  p_field text,
  p_value_json jsonb,
  p_origin text,
  p_confidence_band text,
  p_evidence_ids uuid[],
  p_ai_run_id uuid,
  p_dedupe_key text,
  p_activate boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_user_id uuid := p_user_id;
  v_claim_id uuid;
  v_existing public.claims%rowtype;
  v_evidence_id uuid;
  v_expected_count integer;
  v_valid_count integer;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_origin not in ('deterministic','ai') then
    raise exception 'only deterministic or AI claims use this function' using errcode = '22023';
  end if;
  if p_field is null or char_length(p_field) not between 1 and 80 then
    raise exception 'invalid claim field' using errcode = '22023';
  end if;
  if p_value_json is null or private.contains_exact_location(p_value_json) then
    raise exception 'invalid claim value' using errcode = '22023';
  end if;
  if p_confidence_band not in ('low','medium','high') then
    raise exception 'unsupported claims cannot be activated' using errcode = '22023';
  end if;
  if p_activate and p_origin = 'ai' and p_confidence_band = 'low' then
    raise exception 'low-confidence AI claims must remain provisional'
      using errcode = '23514';
  end if;
  if p_evidence_ids is null or cardinality(p_evidence_ids) = 0
     or exists (select 1 from unnest(p_evidence_ids) item where item is null) then
    raise exception 'at least one evidence ID is required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.memories
    where id = p_memory_id and user_id = v_user_id and status not in ('deleting','deleted')
  ) then
    raise exception 'memory not found' using errcode = 'P0002';
  end if;
  if p_ai_run_id is not null and not exists (
    select 1 from public.ai_runs where id = p_ai_run_id and user_id = v_user_id
  ) then
    raise exception 'AI run not found' using errcode = 'P0002';
  end if;
  if p_origin = 'deterministic' and p_ai_run_id is not null then
    raise exception 'deterministic claims cannot reference an AI run' using errcode = '22023';
  end if;
  if p_origin = 'ai' and p_ai_run_id is null then
    raise exception 'AI claims require AI run provenance' using errcode = '23514';
  end if;

  if p_dedupe_key is not null then
    select * into v_existing
    from public.claims
    where user_id = v_user_id and dedupe_key = p_dedupe_key;
    if found then
      if v_existing.memory_id <> p_memory_id
         or v_existing.field <> p_field
         or v_existing.origin <> p_origin
         or v_existing.value_json is distinct from p_value_json
         or v_existing.confidence_band <> p_confidence_band
         or (v_existing.status = 'active') is distinct from p_activate then
        raise exception 'idempotency key was reused with a different claim'
          using errcode = '22023';
      end if;
      return v_existing.id;
    end if;
  end if;

  select count(*) into v_expected_count
  from (select distinct item from unnest(p_evidence_ids) item) requested;
  select count(*) into v_valid_count
  from (
    select distinct item from unnest(p_evidence_ids) item
  ) requested
  where private.evidence_belongs_to_memory(requested.item, p_memory_id, v_user_id);
  if v_valid_count <> v_expected_count then
    raise exception 'one or more evidence rows are invalid or outside this memory'
      using errcode = '42501';
  end if;

  insert into public.claims (
    user_id, memory_id, field, value_json, origin, confidence_band,
    confirmation_status, status, ai_run_id, dedupe_key
  ) values (
    v_user_id, p_memory_id, p_field, p_value_json, p_origin, p_confidence_band,
    'unconfirmed', 'generated', p_ai_run_id, p_dedupe_key
  ) returning id into v_claim_id;

  for v_evidence_id in select distinct item from unnest(p_evidence_ids) item
  loop
    insert into public.claim_evidence(user_id, claim_id, evidence_id)
    values (v_user_id, v_claim_id, v_evidence_id);
  end loop;

  if p_activate then
    if p_origin = 'ai' then
      update public.claims
      set status = 'superseded'
      where user_id = v_user_id and memory_id = p_memory_id and field = p_field
        and origin = 'ai' and status = 'active' and id <> v_claim_id;
    end if;
    update public.claims set status = 'active' where id = v_claim_id;
  end if;
  return v_claim_id;
exception
  when unique_violation then
    if p_dedupe_key is not null then
      select * into v_existing from public.claims
      where user_id = v_user_id and dedupe_key = p_dedupe_key;
      if found and v_existing.memory_id = p_memory_id
         and v_existing.field = p_field
         and v_existing.origin = p_origin
         and v_existing.value_json is not distinct from p_value_json then
        return v_existing.id;
      end if;
    end if;
    raise;
end;
$function$;

-- Confirmation/correction is append-only and idempotent. It never upgrades an
-- AI row in place; it creates a correction and a new user-origin claim.
create or replace function public.apply_user_correction(
  p_user_id uuid,
  p_memory_id uuid,
  p_target_claim_id uuid,
  p_action text,
  p_value_json jsonb,
  p_field text,
  p_idempotency_key uuid
)
returns table (
  correction_id uuid,
  created_claim_id uuid,
  target_claim_status text,
  memory_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_user_id uuid := p_user_id;
  v_target public.claims%rowtype;
  v_correction_id uuid := gen_random_uuid();
  v_created_claim_id uuid;
  v_field text;
  v_value jsonb;
  v_conflict boolean := false;
  v_target_status text;
  v_memory_status text;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_action not in ('confirm','replace','reject','resolve') then
    raise exception 'invalid correction action' using errcode = '22023';
  end if;

  perform 1 from public.memories
  where id = p_memory_id and user_id = v_user_id and status not in ('deleting','deleted')
  for update;
  if not found then
    raise exception 'memory not found' using errcode = 'P0002';
  end if;

  -- Serialize identical retries on the memory row before checking the unique key.
  select uc.id, uc.created_claim_id
    into v_correction_id, v_created_claim_id
  from public.user_corrections uc
  where uc.user_id = v_user_id and uc.idempotency_key = p_idempotency_key;
  if found then
    if not exists (
      select 1 from public.user_corrections uc
      where uc.id = v_correction_id and uc.user_id = v_user_id
        and uc.memory_id = p_memory_id
        and uc.target_claim_id is not distinct from p_target_claim_id
        and uc.action = p_action
        and uc.value_json is not distinct from (
          case when p_action = 'confirm' and p_value_json is null then uc.value_json else p_value_json end
        )
    ) then
      raise exception 'idempotency key was reused with a different correction'
        using errcode = '22023';
    end if;
    select status into v_target_status from public.claims
      where id = p_target_claim_id and memory_id = p_memory_id and user_id = v_user_id;
    select status into v_memory_status from public.memories
      where id = p_memory_id and user_id = v_user_id;
    return query select v_correction_id, v_created_claim_id, v_target_status, v_memory_status;
    return;
  end if;

  if p_target_claim_id is not null then
    select * into v_target
    from public.claims
    where id = p_target_claim_id and memory_id = p_memory_id and user_id = v_user_id
    for update;
    if not found then
      raise exception 'target claim not found' using errcode = 'P0002';
    end if;
    if v_target.origin not in ('ai','deterministic')
       and not (p_action = 'resolve' and v_target.origin = 'user') then
      raise exception 'only inferred claims can be confirmed or replaced' using errcode = '22023';
    end if;
    if v_target.status not in ('generated','active','disputed') then
      raise exception 'target claim is not correctable' using errcode = '55000';
    end if;
  elsif p_action = 'reject' then
    raise exception 'reject requires a target claim' using errcode = '22023';
  end if;

  v_field := coalesce(nullif(btrim(p_field), ''), v_target.field);
  if v_field is null or char_length(v_field) > 80 then
    raise exception 'a valid field is required' using errcode = '22023';
  end if;
  if p_target_claim_id is not null and p_action <> 'resolve' and v_field <> v_target.field then
    raise exception 'correction field must match its target claim' using errcode = '22023';
  end if;
  if p_action = 'confirm' and p_value_json is not null
     and p_value_json is distinct from v_target.value_json then
    raise exception 'confirm cannot replace the target value' using errcode = '22023';
  end if;
  v_value := case
    when p_action = 'confirm' and p_value_json is null then v_target.value_json
    else p_value_json
  end;
  if (v_value is not null and private.contains_exact_location(v_value))
     or (p_action <> 'reject' and v_value is null) then
    raise exception 'a privacy-safe value is required' using errcode = '22023';
  end if;

  if p_action = 'reject' then
    insert into public.user_corrections (
      id, user_id, memory_id, target_claim_id, action, value_json, idempotency_key
    ) values (
      v_correction_id, v_user_id, p_memory_id, p_target_claim_id, p_action, null, p_idempotency_key
    );
    update public.claims set status = 'rejected'
    where id = p_target_claim_id and status not in ('deleted','rejected');
    update public.memory_gaps
      set status = 'dismissed'
      where user_id = v_user_id and memory_id = p_memory_id
        and status in ('detected','ready_to_ask')
        and (dimension = v_field or gap_type = v_field);
  else
    v_created_claim_id := gen_random_uuid();

    if p_action = 'resolve' then
      update public.claims
      set status = 'superseded', confirmation_status = 'user_confirmed'
      where user_id = v_user_id and memory_id = p_memory_id and field = v_field
        and origin = 'user' and status = 'disputed';
    elsif p_target_claim_id is not null then
      update public.claims
      set status = 'superseded'
      where id = p_target_claim_id and status not in ('deleted','rejected');
    end if;

    if p_action <> 'resolve' then
      select exists (
        select 1 from public.claims
        where user_id = v_user_id and memory_id = p_memory_id and field = v_field
          and id is distinct from p_target_claim_id
          and origin = 'user' and status = 'active'
          and confirmation_status = 'user_confirmed'
          and value_json is distinct from v_value
        for update
      ) into v_conflict;
    end if;

    insert into public.user_corrections (
      id, user_id, memory_id, target_claim_id, created_claim_id,
      action, value_json, idempotency_key
    ) values (
      v_correction_id, v_user_id, p_memory_id, p_target_claim_id, v_created_claim_id,
      p_action, v_value, p_idempotency_key
    );

    if v_conflict then
      update public.claims
      set status = 'disputed', confirmation_status = 'disputed'
      where user_id = v_user_id and memory_id = p_memory_id and field = v_field
        and origin = 'user' and status = 'active';
    end if;

    insert into public.claims (
      id, user_id, memory_id, field, value_json, origin, confidence_band,
      confirmation_status, status, source_correction_id
    ) values (
      v_created_claim_id, v_user_id, p_memory_id, v_field, v_value, 'user', 'high',
      case when v_conflict then 'disputed' else 'user_confirmed' end,
      case when v_conflict then 'disputed' else 'active' end,
      v_correction_id
    );

    if v_conflict then
      update public.memories set status = 'disputed' where id = p_memory_id;
    else
      update public.memory_context_dimensions
      set status = 'known', active_claim_id = v_created_claim_id
      where user_id = v_user_id and memory_id = p_memory_id and dimension = v_field;

      update public.memory_gaps
      set status = 'resolved', resolved_at = statement_timestamp()
      where user_id = v_user_id and memory_id = p_memory_id
        and status in ('detected','ready_to_ask','deferred')
        and (dimension = v_field or gap_type = v_field);

      if p_action = 'resolve' then
        update public.memories
        set status = case
          when exists (
            select 1 from public.claims
            where memory_id = p_memory_id and user_id = v_user_id and status = 'disputed'
          ) then 'disputed' else 'active' end
        where id = p_memory_id;
      else
        update public.memories set status = 'active'
        where id = p_memory_id and status = 'draft';
      end if;
    end if;
  end if;

  select status into v_target_status from public.claims where id = p_target_claim_id;
  select status into v_memory_status from public.memories where id = p_memory_id;
  return query select v_correction_id, v_created_claim_id, v_target_status, v_memory_status;
end;
$function$;

-- Memory-gap confirmation binds the exact candidate claim selected when the gap
-- was created. The correction and gap resolution happen in one transaction.
create or replace function public.apply_memory_gap_correction(
  p_user_id uuid,
  p_gap_id uuid,
  p_action text,
  p_value_json jsonb,
  p_field text,
  p_idempotency_key uuid
)
returns table (
  correction_id uuid,
  created_claim_id uuid,
  target_claim_status text,
  memory_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_user_id uuid := p_user_id;
  v_gap public.memory_gaps%rowtype;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  select * into v_gap from public.memory_gaps
  where id = p_gap_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'memory gap not found' using errcode = 'P0002';
  end if;
  if v_gap.status not in ('detected','ready_to_ask','deferred') then
    if exists (
      select 1 from public.user_corrections
      where user_id = v_user_id and idempotency_key = p_idempotency_key
    ) then
      return query select * from public.apply_user_correction(
        v_user_id, v_gap.memory_id, v_gap.target_claim_id, p_action, p_value_json,
        coalesce(nullif(p_field, ''), v_gap.dimension), p_idempotency_key
      );
      return;
    end if;
    raise exception 'memory gap is not answerable' using errcode = '55000';
  end if;
  if v_gap.target_claim_id is null then
    raise exception 'memory gap has no bound candidate claim' using errcode = '23514';
  end if;
  if coalesce(nullif(p_field, ''), v_gap.dimension) is distinct from v_gap.dimension then
    raise exception 'correction field must match the gap dimension' using errcode = '22023';
  end if;
  if p_action = 'confirm' and v_gap.candidate_value_json is not null
     and coalesce(p_value_json, v_gap.candidate_value_json) is distinct from v_gap.candidate_value_json then
    raise exception 'confirm value must match the gap candidate' using errcode = '22023';
  end if;

  return query select * from public.apply_user_correction(
    v_user_id,
    v_gap.memory_id,
    v_gap.target_claim_id,
    p_action,
    case when p_action = 'confirm' then coalesce(p_value_json, v_gap.candidate_value_json) else p_value_json end,
    coalesce(nullif(p_field, ''), v_gap.dimension),
    p_idempotency_key
  );
  -- apply_user_correction already resolves same-field gaps. Exact-ID binding
  -- ensures this row is also resolved even if gap_type differs from dimension.
  update public.memory_gaps
  set status = 'resolved', resolved_at = statement_timestamp()
  where id = p_gap_id and user_id = v_user_id;
end;
$function$;

-- Deletion is two-phase: request immediately removes the memory from all normal
-- retrieval; finalize is called only after the Storage API removed its objects.
create or replace function public.request_memory_deletion(p_user_id uuid, p_memory_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := p_user_id;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  update public.memories
  set status = 'deleting'
  where id = p_memory_id and user_id = v_user_id and status not in ('deleting','deleted');
  if found then
    return true;
  end if;
  return exists (
    select 1 from public.memories
    where id = p_memory_id and user_id = v_user_id and status = 'deleting'
  );
end;
$function$;

create or replace function public.finalize_memory_deletion(p_user_id uuid, p_memory_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $function$
declare
  v_user_id uuid := p_user_id;
  v_event_id uuid;
  v_sequence_id uuid;
  v_asset_ids uuid[];
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  select memory.event_id, event.sequence_id
    into v_event_id, v_sequence_id
  from public.memories memory
  join public.events event on event.id = memory.event_id and event.user_id = memory.user_id
  where memory.id = p_memory_id and memory.user_id = v_user_id and memory.status = 'deleting'
  for update of memory, event;
  if not found then
    return false;
  end if;

  select coalesce(array_agg(asset_id), '{}'::uuid[]) into v_asset_ids
  from public.sequence_assets
  where user_id = v_user_id and sequence_id = v_sequence_id;

  if exists (
    select 1 from storage.objects object
    join unnest(v_asset_ids) asset_id
      on object.name like v_user_id::text || '/assets/' || asset_id::text || '/%'
    where object.bucket_id = 'rememory-private'
  ) then
    raise exception 'private storage objects must be removed before finalization'
      using errcode = '55000';
  end if;

  delete from public.events where id = v_event_id and user_id = v_user_id;
  if v_sequence_id is not null then
    delete from public.media_sequences where id = v_sequence_id and user_id = v_user_id;
  end if;
  delete from public.media_assets asset
  where asset.user_id = v_user_id and asset.id = any(v_asset_ids);
  return true;
end;
$function$;

-- Atomic fixed-window counter. Limit comparison remains server configuration;
-- clients receive only the count and cannot cause an AI call by invoking this.
create or replace function public.consume_ai_rate_limit(
  p_user_id uuid,
  p_key text,
  p_window_started_at_ms bigint,
  p_expires_at_ms bigint
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := p_user_id;
  v_count bigint;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_key is null or char_length(p_key) not between 1 and 160
     or p_window_started_at_ms < 0 or p_expires_at_ms <= p_window_started_at_ms
     or p_expires_at_ms - p_window_started_at_ms > 86400000 then
    raise exception 'invalid rate-limit window' using errcode = '22023';
  end if;
  delete from public.ai_rate_limits
  where user_id = v_user_id and expires_at_ms < (extract(epoch from clock_timestamp()) * 1000)::bigint;
  insert into public.ai_rate_limits(user_id, key, window_started_at_ms, expires_at_ms, request_count)
  values (v_user_id, p_key, p_window_started_at_ms, p_expires_at_ms, 1)
  on conflict (user_id, key, window_started_at_ms) do update
    set request_count = public.ai_rate_limits.request_count + 1,
        expires_at_ms = greatest(public.ai_rate_limits.expires_at_ms, excluded.expires_at_ms)
  returning request_count into v_count;
  return v_count;
end;
$function$;

create or replace function public.reserve_ai_cost(
  p_user_id uuid,
  p_purpose text,
  p_day_key date,
  p_amount_usd numeric,
  p_daily_limit_usd numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := p_user_id;
  v_budget public.ai_daily_budgets%rowtype;
  v_reservation_id uuid;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_purpose is null or char_length(p_purpose) not between 1 and 80
     or p_amount_usd is null or p_amount_usd < 0 or p_amount_usd > 10
     or p_daily_limit_usd is null or p_daily_limit_usd < 0 or p_daily_limit_usd > 100
     or p_day_key is null or abs(p_day_key - current_date) > 1 then
    raise exception 'invalid cost reservation' using errcode = '22023';
  end if;

  insert into public.ai_daily_budgets(user_id, day_key, daily_limit_usd)
  values (v_user_id, p_day_key, p_daily_limit_usd)
  on conflict (user_id, day_key) do update
    set daily_limit_usd = least(public.ai_daily_budgets.daily_limit_usd, excluded.daily_limit_usd);

  select * into v_budget from public.ai_daily_budgets
  where user_id = v_user_id and day_key = p_day_key for update;
  if v_budget.committed_usd + v_budget.reserved_usd + p_amount_usd > v_budget.daily_limit_usd then
    return null;
  end if;

  update public.ai_daily_budgets
  set reserved_usd = reserved_usd + p_amount_usd
  where user_id = v_user_id and day_key = p_day_key;
  insert into public.ai_cost_reservations(user_id, purpose, day_key, reserved_usd)
  values (v_user_id, p_purpose, p_day_key, p_amount_usd)
  returning id into v_reservation_id;
  return v_reservation_id;
end;
$function$;

create or replace function public.commit_ai_cost(
  p_user_id uuid,
  p_reservation_id uuid,
  p_actual_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := p_user_id;
  v_reservation public.ai_cost_reservations%rowtype;
  v_budget public.ai_daily_budgets%rowtype;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_actual_cost_usd is null or p_actual_cost_usd < 0 or p_actual_cost_usd > 10 then
    raise exception 'invalid actual cost' using errcode = '22023';
  end if;
  select * into v_reservation from public.ai_cost_reservations
  where id = p_reservation_id and user_id = v_user_id for update;
  if not found then
    raise exception 'reservation not found' using errcode = 'P0002';
  end if;
  if v_reservation.status = 'committed' then
    if v_reservation.actual_usd is distinct from p_actual_cost_usd then
      raise exception 'reservation already committed with another amount' using errcode = '22023';
    end if;
    return;
  elsif v_reservation.status <> 'reserved' then
    raise exception 'reservation is not active' using errcode = '55000';
  end if;

  select * into v_budget from public.ai_daily_budgets
  where user_id = v_user_id and day_key = v_reservation.day_key for update;
  if v_budget.committed_usd + v_budget.reserved_usd - v_reservation.reserved_usd
     + p_actual_cost_usd > v_budget.daily_limit_usd then
    raise exception 'actual cost exceeds daily budget' using errcode = '54000';
  end if;
  update public.ai_daily_budgets
  set reserved_usd = reserved_usd - v_reservation.reserved_usd,
      committed_usd = committed_usd + p_actual_cost_usd
  where user_id = v_user_id and day_key = v_reservation.day_key;
  update public.ai_cost_reservations
  set status = 'committed', actual_usd = p_actual_cost_usd, settled_at = statement_timestamp()
  where id = p_reservation_id;
end;
$function$;

create or replace function public.release_ai_cost(p_user_id uuid, p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := p_user_id;
  v_reservation public.ai_cost_reservations%rowtype;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  select * into v_reservation from public.ai_cost_reservations
  where id = p_reservation_id and user_id = v_user_id for update;
  if not found then
    raise exception 'reservation not found' using errcode = 'P0002';
  end if;
  if v_reservation.status = 'released' then
    return;
  elsif v_reservation.status <> 'reserved' then
    raise exception 'committed reservations cannot be released' using errcode = '55000';
  end if;
  update public.ai_daily_budgets
  set reserved_usd = reserved_usd - v_reservation.reserved_usd
  where user_id = v_user_id and day_key = v_reservation.day_key;
  update public.ai_cost_reservations
  set status = 'released', settled_at = statement_timestamp()
  where id = p_reservation_id;
end;
$function$;

-- RLS is enabled on every private table. Join tables carry a redundant user_id
-- solely so ownership is both FK-enforced and cheap to express in policies.
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.media_assets enable row level security;
alter table public.media_sequences enable row level security;
alter table public.sequence_assets enable row level security;
alter table public.events enable row level security;
alter table public.evidence enable row level security;
alter table public.memories enable row level security;
alter table public.ai_runs enable row level security;
alter table public.claims enable row level security;
alter table public.user_corrections enable row level security;
alter table public.claim_evidence enable row level security;
alter table public.memory_context_dimensions enable row level security;
alter table public.memory_gaps enable row level security;
alter table public.memory_relations enable row level security;
alter table public.personal_context enable row level security;
alter table public.ai_rate_limits enable row level security;
alter table public.ai_daily_budgets enable row level security;
alter table public.ai_cost_reservations enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy preferences_select_own on public.user_preferences for select to authenticated
  using (user_id = auth.uid());
create policy preferences_update_own on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy media_assets_select_own on public.media_assets for select to authenticated
  using (user_id = auth.uid());
create policy media_sequences_select_own on public.media_sequences for select to authenticated
  using (user_id = auth.uid());
create policy sequence_assets_select_own on public.sequence_assets for select to authenticated
  using (user_id = auth.uid());
create policy events_select_own on public.events for select to authenticated
  using (user_id = auth.uid());
create policy evidence_select_own on public.evidence for select to authenticated
  using (user_id = auth.uid());
create policy memories_select_own on public.memories for select to authenticated
  using (user_id = auth.uid());
create policy context_dimensions_select_own on public.memory_context_dimensions for select to authenticated
  using (user_id = auth.uid());
create policy memory_gaps_select_own on public.memory_gaps for select to authenticated
  using (user_id = auth.uid());
create policy memory_relations_select_own on public.memory_relations for select to authenticated
  using (user_id = auth.uid());
create policy personal_context_select_own on public.personal_context for select to authenticated
  using (user_id = auth.uid());

-- Provenance tables are readable by their owner but writable only through the
-- SECURITY DEFINER transactions above (ai_runs remains insert-only telemetry).
create policy claims_select_own on public.claims for select to authenticated
  using (user_id = auth.uid());
create policy corrections_select_own on public.user_corrections for select to authenticated
  using (user_id = auth.uid());
create policy claim_evidence_select_own on public.claim_evidence for select to authenticated
  using (user_id = auth.uid());
create policy ai_runs_select_own on public.ai_runs for select to authenticated
  using (user_id = auth.uid());
create policy ai_rate_limits_select_own on public.ai_rate_limits for select to authenticated
  using (user_id = auth.uid());
create policy ai_daily_budgets_select_own on public.ai_daily_budgets for select to authenticated
  using (user_id = auth.uid());
create policy ai_cost_reservations_select_own on public.ai_cost_reservations for select to authenticated
  using (user_id = auth.uid());

-- Normal retrieval consumes this security-invoker view rather than hand-rolling
-- the eligibility predicate. Deleted/disputed/unsupported data is excluded.
create view public.eligible_grounded_claims
with (security_invoker = true)
as
select
  claim.id,
  claim.user_id,
  claim.memory_id,
  claim.field,
  claim.value_json,
  claim.origin,
  claim.confidence_band,
  claim.confirmation_status,
  claim.source_correction_id,
  coalesce(
    array(
      select link.evidence_id
      from public.claim_evidence link
      join public.evidence evidence on evidence.id = link.evidence_id
      where link.claim_id = claim.id and link.user_id = claim.user_id and evidence.validity = 'valid'
      order by link.evidence_id
    ), '{}'::uuid[]
  ) as evidence_ids
from public.claims claim
join public.memories memory on memory.id = claim.memory_id and memory.user_id = claim.user_id
where memory.status = 'active'
  and claim.status = 'active'
  and (
    claim.origin = 'user'
    or claim.confidence_band in ('medium','high')
  )
  and claim.confirmation_status <> 'disputed'
  and (
    (claim.origin = 'user' and claim.source_correction_id is not null)
    or (claim.origin in ('ai','deterministic') and exists (
      select 1 from public.claim_evidence link
      join public.evidence evidence on evidence.id = link.evidence_id
      where link.claim_id = claim.id and link.user_id = claim.user_id and evidence.validity = 'valid'
    ))
  );

-- Explicit table privileges complement RLS. The browser cannot fabricate or
-- mutate provenance rows even if a future policy is accidentally broadened.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.user_preferences, public.media_assets,
  public.media_sequences, public.sequence_assets, public.events, public.evidence,
  public.memories, public.memory_context_dimensions, public.memory_gaps,
  public.memory_relations, public.personal_context, public.claims,
  public.claim_evidence, public.user_corrections, public.ai_runs,
  public.ai_rate_limits, public.ai_daily_budgets, public.ai_cost_reservations
to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant update (
  use_photos, use_captured_at, use_location, use_calendar, use_people,
  use_personal_context, search_learning_enabled, confirmation_timing,
  preferred_confirmation_time, updated_at
) on public.user_preferences to authenticated;
grant select on public.eligible_grounded_claims to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.claim_sequence_analysis(uuid,uuid,uuid[],integer) from public, anon, authenticated;
revoke all on function public.complete_sequence_analysis(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.create_evidence_backed_claim(uuid,uuid,text,jsonb,text,text,uuid[],uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.apply_user_correction(uuid,uuid,uuid,text,jsonb,text,uuid) from public, anon, authenticated;
revoke all on function public.apply_memory_gap_correction(uuid,uuid,text,jsonb,text,uuid) from public, anon, authenticated;
revoke all on function public.request_memory_deletion(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finalize_memory_deletion(uuid,uuid) from public, anon, authenticated;
revoke all on function public.consume_ai_rate_limit(uuid,text,bigint,bigint) from public, anon, authenticated;
revoke all on function public.reserve_ai_cost(uuid,text,date,numeric,numeric) from public, anon, authenticated;
revoke all on function public.commit_ai_cost(uuid,uuid,numeric) from public, anon, authenticated;
revoke all on function public.release_ai_cost(uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_evidence_backed_claim(uuid,uuid,text,jsonb,text,text,uuid[],uuid,text,boolean) to service_role;
grant execute on function public.claim_sequence_analysis(uuid,uuid,uuid[],integer) to service_role;
grant execute on function public.complete_sequence_analysis(uuid,uuid,text) to service_role;
grant execute on function public.apply_user_correction(uuid,uuid,uuid,text,jsonb,text,uuid) to service_role;
grant execute on function public.apply_memory_gap_correction(uuid,uuid,text,jsonb,text,uuid) to service_role;
grant execute on function public.request_memory_deletion(uuid,uuid) to service_role;
grant execute on function public.finalize_memory_deletion(uuid,uuid) to service_role;
grant execute on function public.consume_ai_rate_limit(uuid,text,bigint,bigint) to service_role;
grant execute on function public.reserve_ai_cost(uuid,text,date,numeric,numeric) to service_role;
grant execute on function public.commit_ai_cost(uuid,uuid,numeric) to service_role;
grant execute on function public.release_ai_cost(uuid,uuid) to service_role;

-- Private Storage. Object keys are exactly:
-- {userId}/assets/{assetId}/original or .../vision.webp
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rememory-private',
  'rememory-private',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy rememory_storage_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'rememory-private'
  and name ~ ('^' || auth.uid()::text || '/assets/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(original|vision\\.webp)$')
);

comment on table public.user_corrections is
  'Append-only human corrections. Browser writes are revoked; use apply_user_correction().';
comment on view public.eligible_grounded_claims is
  'Only active, supported, non-disputed claims belonging to active memories; RLS runs as invoker.';
comment on column public.media_assets.coarse_place is
  'Privacy-minimized place label only. Exact GPS must not be persisted.';
comment on table public.ai_runs is
  'Cost/status telemetry only. Never store prompt text, answers, filenames, URLs, EXIF, or coordinates.';
