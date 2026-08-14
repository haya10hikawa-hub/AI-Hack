-- PL/pgSQL SELECT INTO sets target variables to null when no row is found.
-- apply_user_correction initialized v_correction_id before the idempotency
-- lookup, then the no-match lookup nulled it. Fresh corrections therefore tried
-- to insert user_corrections.id = null and blocked upload-time user location
-- claims. Recreate the function with v_correction_id generated after the
-- no-match branch.

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
  v_correction_id uuid;
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
  v_correction_id := gen_random_uuid();

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
