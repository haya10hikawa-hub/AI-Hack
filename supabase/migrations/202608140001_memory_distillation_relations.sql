begin;

create table public.memory_representatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  asset_id uuid not null,
  role text not null check (role in ('identity','key_moment','complement')),
  reason text not null check (char_length(reason) between 1 and 500),
  source_ai_run_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (memory_id, role),
  unique (memory_id, asset_id),
  foreign key (memory_id, user_id)
    references public.memories(id, user_id) on delete cascade,
  foreign key (asset_id, user_id)
    references public.media_assets(id, user_id) on delete cascade,
  foreign key (source_ai_run_id, user_id)
    references public.ai_runs(id, user_id) on delete restrict
);

create index memory_representatives_asset_idx
  on public.memory_representatives(asset_id);

create or replace function private.validate_memory_representative()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1
    from public.memories memory
    join public.events event
      on event.id = memory.event_id and event.user_id = memory.user_id
    join public.sequence_assets candidate
      on candidate.sequence_id = event.sequence_id
     and candidate.user_id = memory.user_id
     and candidate.asset_id = new.asset_id
     and candidate.is_representative
    join public.media_assets asset
      on asset.id = candidate.asset_id and asset.user_id = candidate.user_id
    where memory.id = new.memory_id
      and memory.user_id = new.user_id
      and memory.status not in ('deleting','deleted')
      and asset.analysis_status not in ('failed','not_supported')
  ) then
    raise exception 'representative must be an eligible analysis candidate for the Memory'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.ai_runs
    where id = new.source_ai_run_id
      and user_id = new.user_id
      and purpose = 'analyze_sequence'
      and status = 'success'
  ) then
    raise exception 'representative requires successful sequence-analysis provenance'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger memory_representatives_validate
before insert or update on public.memory_representatives
for each row execute function private.validate_memory_representative();

create or replace function public.replace_memory_representatives(
  p_user_id uuid,
  p_memory_id uuid,
  p_source_ai_run_id uuid,
  p_representatives jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_item jsonb;
  v_asset_id uuid;
  v_role text;
  v_reason text;
begin
  if p_user_id is null or not exists (
    select 1 from public.memories
    where id = p_memory_id and user_id = p_user_id
      and status not in ('deleting','deleted')
    for update
  ) then
    raise exception 'memory not found' using errcode = 'P0002';
  end if;
  if p_representatives is null
     or jsonb_typeof(p_representatives) <> 'array'
     or jsonb_array_length(p_representatives) <> 3 then
    raise exception 'exactly three representatives are required'
      using errcode = '23514';
  end if;

  delete from public.memory_representatives
  where user_id = p_user_id and memory_id = p_memory_id;

  for v_item in select value from jsonb_array_elements(p_representatives)
  loop
    v_asset_id := (v_item ->> 'assetId')::uuid;
    v_role := v_item ->> 'role';
    v_reason := btrim(v_item ->> 'reason');
    if v_role not in ('identity','key_moment','complement')
       or v_reason is null or char_length(v_reason) not between 1 and 500 then
      raise exception 'invalid representative role or reason'
        using errcode = '22023';
    end if;
    insert into public.memory_representatives (
      user_id, memory_id, asset_id, role, reason, source_ai_run_id
    ) values (
      p_user_id, p_memory_id, v_asset_id, v_role, v_reason, p_source_ai_run_id
    );
  end loop;

  if not exists (
    select 1
    from public.memory_representatives
    where user_id = p_user_id and memory_id = p_memory_id
    having count(*) = 3
       and count(*) filter (where role = 'identity') = 1
       and count(*) filter (where role = 'key_moment') = 1
       and count(*) filter (where role = 'complement') = 1
  ) then
    raise exception 'representative role set is incomplete' using errcode = '23514';
  end if;
  return true;
end;
$function$;

alter table public.memory_relations
  add column dedupe_key text
    check (dedupe_key is null or char_length(dedupe_key) between 1 and 500);

alter table public.memory_relations
  add constraint memory_relations_mvp_type_check
  check (relation_type in ('before','same_place','same_activity')) not valid;

alter table public.memory_relations
  add constraint memory_relations_symmetric_canonical_check
  check (
    relation_type not in ('same_place','same_activity')
    or source_memory_id::text < target_memory_id::text
  ) not valid;

create unique index memory_relations_dedupe_idx
  on public.memory_relations(user_id, dedupe_key)
  where dedupe_key is not null;

create or replace function private.reject_relation_exact_location_json()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $function$
begin
  if private.contains_exact_location(new.reason_json) then
    raise exception 'exact location fields are not allowed in relation reasons'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger memory_relations_reject_exact_location
before insert or update of reason_json on public.memory_relations
for each row execute function private.reject_relation_exact_location_json();

create or replace function public.replace_memory_relations(
  p_user_id uuid,
  p_memory_id uuid,
  p_relations jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_item jsonb;
  v_source uuid;
  v_target uuid;
  v_type text;
  v_reason jsonb;
  v_source_time timestamptz;
  v_target_time timestamptz;
  v_source_place text;
  v_target_place text;
  v_claim_memories integer;
  v_claim_values integer;
  v_count integer := 0;
begin
  if p_user_id is null or not exists (
    select 1 from public.memories
    where id = p_memory_id and user_id = p_user_id and status = 'active'
    for update
  ) then
    raise exception 'memory not found' using errcode = 'P0002';
  end if;
  if p_relations is null
     or jsonb_typeof(p_relations) <> 'array'
     or jsonb_array_length(p_relations) > 8 then
    raise exception 'relation refresh must be a bounded array'
      using errcode = '22023';
  end if;

  delete from public.memory_relations
  where user_id = p_user_id
    and origin = 'deterministic'
    and relation_type in ('before','same_place','same_activity')
    and (source_memory_id = p_memory_id or target_memory_id = p_memory_id);

  for v_item in select value from jsonb_array_elements(p_relations)
  loop
    v_source := (v_item ->> 'sourceMemoryId')::uuid;
    v_target := (v_item ->> 'targetMemoryId')::uuid;
    v_type := v_item ->> 'relationType';
    v_reason := v_item -> 'reason';
    if v_source = v_target
       or p_memory_id not in (v_source, v_target)
       or v_type not in ('before','same_place','same_activity')
       or jsonb_typeof(v_reason) <> 'object'
       or private.contains_exact_location(v_reason) then
      raise exception 'invalid relation' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.memories
      where user_id = p_user_id and id in (v_source, v_target)
        and status = 'active'
      having count(*) = 2
    ) then
      raise exception 'relation Memories must be active and share one owner'
        using errcode = '23514';
    end if;

    if v_type in ('same_place','same_activity')
       and v_source::text >= v_target::text then
      raise exception 'symmetric relation pair is not canonical'
        using errcode = '23514';
    end if;

    if v_type = 'before' then
      select event.started_at into v_source_time
      from public.memories memory
      join public.events event on event.id = memory.event_id and event.user_id = memory.user_id
      where memory.id = v_source and memory.user_id = p_user_id;
      select event.started_at into v_target_time
      from public.memories memory
      join public.events event on event.id = memory.event_id and event.user_id = memory.user_id
      where memory.id = v_target and memory.user_id = p_user_id;
      if v_source_time is null or v_target_time is null or v_source_time >= v_target_time then
        raise exception 'before relation requires ordered Event timestamps'
          using errcode = '23514';
      end if;
    elsif v_type = 'same_place' then
      select event.coarse_place into v_source_place
      from public.memories memory
      join public.events event on event.id = memory.event_id and event.user_id = memory.user_id
      where memory.id = v_source and memory.user_id = p_user_id;
      select event.coarse_place into v_target_place
      from public.memories memory
      join public.events event on event.id = memory.event_id and event.user_id = memory.user_id
      where memory.id = v_target and memory.user_id = p_user_id;
      if v_source_place is null or v_target_place is null
         or lower(regexp_replace(btrim(v_source_place), '\s+', ' ', 'g'))
            <> lower(regexp_replace(btrim(v_target_place), '\s+', ' ', 'g')) then
        raise exception 'same_place requires equal persisted coarse places'
          using errcode = '23514';
      end if;
    else
      if jsonb_typeof(v_reason -> 'supportingClaimIds') <> 'array'
         or jsonb_array_length(v_reason -> 'supportingClaimIds') <> 2 then
        raise exception 'same_activity requires two supporting Claims'
          using errcode = '23514';
      end if;
      select count(distinct claim.memory_id),
             count(distinct lower(regexp_replace(btrim(
               case jsonb_typeof(claim.value_json)
                 when 'string' then claim.value_json #>> '{}'
                 when 'object' then coalesce(
                   claim.value_json ->> 'value', claim.value_json ->> 'label',
                   claim.value_json ->> 'activity', claim.value_json ->> 'name'
                 )
                 else null
               end
             ), '\s+', ' ', 'g')))
        into v_claim_memories, v_claim_values
      from jsonb_array_elements_text(v_reason -> 'supportingClaimIds') supplied(id)
      join public.claims claim on claim.id = supplied.id::uuid
      where claim.user_id = p_user_id
        and claim.memory_id in (v_source, v_target)
        and claim.field = 'activity'
        and claim.status = 'active'
        and claim.confirmation_status <> 'disputed'
        and claim.confidence_band <> 'unsupported'
        and (
          (claim.origin = 'user' and claim.confirmation_status = 'user_confirmed')
          or claim.origin = 'deterministic'
          or (claim.origin = 'ai' and claim.confidence_band in ('medium','high'))
        );
      if v_claim_memories <> 2 or v_claim_values <> 1 then
        raise exception 'same_activity Claims must ground one exact shared activity'
          using errcode = '23514';
      end if;
    end if;

    insert into public.memory_relations (
      user_id, source_memory_id, target_memory_id, relation_type, origin,
      confirmation_status, confidence_band, reason_json, dedupe_key
    ) values (
      p_user_id, v_source, v_target, v_type, 'deterministic',
      'unconfirmed', 'high', v_reason,
      v_source::text || ':' || v_target::text || ':' || v_type
    )
    on conflict (user_id, dedupe_key) where dedupe_key is not null
    do update set
      reason_json = excluded.reason_json,
      confidence_band = excluded.confidence_band,
      updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

alter table public.memory_representatives enable row level security;

create policy memory_representatives_select_own
on public.memory_representatives for select to authenticated
using (user_id = auth.uid());

revoke all on table public.memory_representatives from anon, authenticated;
grant select on table public.memory_representatives to authenticated;

revoke all on function public.replace_memory_representatives(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.replace_memory_relations(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_memory_representatives(uuid,uuid,uuid,jsonb)
  to service_role;
grant execute on function public.replace_memory_relations(uuid,uuid,jsonb)
  to service_role;

commit;
