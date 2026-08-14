-- Product-completion features: explicit, opt-in search feedback.
-- Raw search text is stored only while the user enables search learning.

create table public.search_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  normalized_query text not null check (
    char_length(normalized_query) between 1 and 500
  ),
  outcome text not null check (outcome in ('helpful', 'not_helpful')),
  feedback_count integer not null default 1 check (
    feedback_count between 1 and 1000000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, memory_id, query_hash),
  foreign key (memory_id, user_id)
    references public.memories(id, user_id) on delete cascade
);

create index search_feedback_query_lookup_idx
  on public.search_feedback(user_id, query_hash, updated_at desc);

create trigger search_feedback_set_updated_at
before update on public.search_feedback
for each row execute function private.set_updated_at();

alter table public.search_feedback enable row level security;

create policy search_feedback_select_own
on public.search_feedback for select to authenticated
using (user_id = auth.uid());

revoke all on table public.search_feedback from anon, authenticated;
grant select on table public.search_feedback to authenticated;

comment on table public.search_feedback is
  'Explicit user feedback used for exact-query reranking only when search learning is enabled.';

-- Shared privacy-safe cache. It contains only an approximately 10 km grid key
-- and a public locality label, never exact coordinates or a user identifier.
create table public.coarse_location_labels (
  grid_key text primary key check (
    grid_key ~ '^grid:[0-9a-z]+:[0-9a-z]+:[0-9]+(?:\.[0-9]+)?$'
  ),
  label text not null check (char_length(label) between 1 and 120),
  provider text not null check (char_length(provider) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger coarse_location_labels_set_updated_at
before update on public.coarse_location_labels
for each row execute function private.set_updated_at();

alter table public.coarse_location_labels enable row level security;
revoke all on table public.coarse_location_labels from anon, authenticated;

comment on table public.coarse_location_labels is
  'Service-only cache from coarse grid keys to public locality labels.';

-- Next.js mutation routes use the service-role client for owner-scoped writes.
-- RLS is bypassed only by this server-held credential; every route derives the
-- owner id from a verified user session before issuing a query.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
