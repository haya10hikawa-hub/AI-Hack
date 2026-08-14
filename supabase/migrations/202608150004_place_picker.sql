create table public.canonical_places (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(provider) between 1 and 40),
  provider_place_id text not null check (char_length(provider_place_id) between 1 and 180),
  place_label text not null check (char_length(place_label) between 1 and 160),
  coarse_area text check (coarse_area is null or char_length(coarse_area) <= 160),
  map_cell_id text not null check (map_cell_id ~ '^[0-9a-f]{15}$'),
  place_category text check (place_category is null or char_length(place_category) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_place_id)
);

create trigger canonical_places_set_updated_at
before update on public.canonical_places
for each row execute function private.set_updated_at();

create table public.memory_places (
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid primary key,
  place_id uuid not null references public.canonical_places(id) on delete restrict,
  source text not null default 'user_selected' check (source = 'user_selected'),
  created_at timestamptz not null default now(),
  foreign key (memory_id, user_id)
    references public.memories(id, user_id) on delete cascade
);

alter table public.canonical_places enable row level security;
alter table public.memory_places enable row level security;

revoke all on table public.canonical_places, public.memory_places from anon, authenticated;
grant select, insert, update on table public.canonical_places to service_role;
grant select, insert, update, delete on table public.memory_places to service_role;

create policy memory_places_owner_select on public.memory_places
for select to authenticated using ((select auth.uid()) = user_id);

comment on table public.canonical_places is
  'Provider-verified canonical place metadata. Exact coordinates and provider responses are never stored.';
comment on column public.canonical_places.map_cell_id is
  'Privacy-safe H3 resolution 10 derivative computed transiently inside the provider adapter.';
comment on table public.memory_places is
  'Owner-scoped user-selected canonical place link for a Memory.';
