-- Privacy-first Memory Exploration Map. H3 resolution 10 is approximately a
-- 150m point-to-point cell scale (average edge length about 76m). Exact
-- latitude/longitude and raw paths are intentionally absent from this schema.

alter table public.user_preferences
  add column memory_map_enabled boolean not null default false;

create table public.memory_map_cells (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cell_id text not null check (cell_id ~ '^[0-9a-f]{15}$'),
  state text not null default 'passed'
    check (state in ('passed','experienced','memory')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count integer not null default 1 check (visit_count between 1 and 1000000),
  dwell_bucket text check (
    dwell_bucket is null or
    dwell_bucket in ('pass_through','short','medium','long')
  ),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  memory_count integer not null default 0 check (memory_count >= 0),
  coarse_place text check (coarse_place is null or char_length(coarse_place) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cell_id),
  unique (id, user_id)
);

create trigger memory_map_cells_set_updated_at
before update on public.memory_map_cells
for each row execute function private.set_updated_at();

create table public.memory_map_cell_memories (
  user_id uuid not null references public.profiles(id) on delete cascade,
  cell_id text not null,
  memory_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cell_id, memory_id),
  foreign key (user_id, cell_id)
    references public.memory_map_cells(user_id, cell_id) on delete cascade,
  foreign key (memory_id, user_id)
    references public.memories(id, user_id) on delete cascade
);

create index memory_map_cells_user_last_seen_idx
  on public.memory_map_cells(user_id, last_seen_at desc);
create index memory_map_cell_memories_memory_idx
  on public.memory_map_cell_memories(user_id, memory_id);

create or replace function public.reveal_memory_map_cell(
  p_user_id uuid,
  p_cell_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_cell_id uuid;
begin
  if p_user_id is null or not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    raise exception 'owner profile not found' using errcode = 'P0002';
  end if;
  if p_cell_id is null or p_cell_id !~ '^[0-9a-f]{15}$' then
    raise exception 'invalid privacy cell' using errcode = '22023';
  end if;

  insert into public.memory_map_cells (
    user_id, cell_id, state, first_seen_at, last_seen_at, visit_count
  ) values (
    p_user_id, p_cell_id, 'passed', statement_timestamp(), statement_timestamp(), 1
  )
  on conflict (user_id, cell_id) do update
  set last_seen_at = statement_timestamp(),
      visit_count = least(public.memory_map_cells.visit_count + 1, 1000000),
      -- A reveal can never downgrade an evidence-derived state.
      state = public.memory_map_cells.state
  returning id into v_cell_id;

  return v_cell_id;
end;
$function$;

create or replace function private.refresh_memory_map_cell_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
  v_cell_id text := coalesce(new.cell_id, old.cell_id);
begin
  update public.memory_map_cells cell
  set memory_count = (
        select count(*)::integer
        from public.memory_map_cell_memories link
        join public.memories memory
          on memory.id = link.memory_id
         and memory.user_id = link.user_id
         and memory.status = 'active'
        where link.user_id = v_user_id and link.cell_id = v_cell_id
      ),
      state = case
        when exists (
          select 1
          from public.memory_map_cell_memories link
          join public.memories memory
            on memory.id = link.memory_id
           and memory.user_id = link.user_id
           and memory.status = 'active'
          where link.user_id = v_user_id and link.cell_id = v_cell_id
        ) then 'memory'
        else cell.state
      end
  where cell.user_id = v_user_id and cell.cell_id = v_cell_id;
  return null;
end;
$function$;

create trigger memory_map_link_refresh_count
after insert or delete on public.memory_map_cell_memories
for each row execute function private.refresh_memory_map_cell_count();

alter table public.memory_map_cells enable row level security;
alter table public.memory_map_cell_memories enable row level security;

create policy memory_map_cells_select_own
on public.memory_map_cells for select to authenticated
using (user_id = auth.uid());

create policy memory_map_cell_memories_select_own
on public.memory_map_cell_memories for select to authenticated
using (user_id = auth.uid());

revoke all on table public.memory_map_cells from public, anon, authenticated;
revoke all on table public.memory_map_cell_memories from public, anon, authenticated;
grant select on table public.memory_map_cells to authenticated;
grant select on table public.memory_map_cell_memories to authenticated;

revoke all on function public.reveal_memory_map_cell(uuid,text)
from public, anon, authenticated;
grant execute on function public.reveal_memory_map_cell(uuid,text)
to service_role;

comment on table public.memory_map_cells is
  'Owner-scoped H3 resolution 10 cells only; never exact coordinates or paths.';
comment on column public.memory_map_cells.cell_id is
  'Privacy-safe H3 resolution 10 cell computed before the server receives location.';
