-- Preserve the earliest unfinished AI stage across retry/lease recovery.
-- `stage` is a checkpoint: analysis -> claims -> gap -> complete. A worker
-- advances it only after the previous stage has persisted its durable output.

-- Older workers advanced `stage` before persisting the Memory title/summary,
-- so their partial checkpoints cannot safely be resumed. Reset only those
-- pre-migration unfinished rows once; new rows use the semantics below.
update public.sequence_analysis_jobs
set stage = 'analysis'
where status <> 'complete' and stage in ('claims','gap');

create or replace function public.enqueue_sequence_analysis_job(
  p_user_id uuid,
  p_sequence_id uuid,
  p_memory_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job_id uuid;
begin
  if not exists (
    select 1
    from public.memories memory
    join public.events event
      on event.id = memory.event_id and event.user_id = memory.user_id
    where memory.id = p_memory_id
      and memory.user_id = p_user_id
      and memory.status = 'active'
      and event.sequence_id = p_sequence_id
      and event.status = 'active'
  ) then
    raise exception 'active owner sequence memory not found' using errcode = 'P0002';
  end if;

  insert into public.sequence_analysis_jobs (
    user_id, sequence_id, memory_id, status, stage, available_at
  ) values (
    p_user_id, p_sequence_id, p_memory_id, 'queued', 'queued', clock_timestamp()
  )
  on conflict (user_id, sequence_id) do update
  set memory_id = excluded.memory_id,
      status = case
        when sequence_analysis_jobs.status in ('complete','processing')
          then sequence_analysis_jobs.status
        else 'queued'
      end,
      stage = case
        when sequence_analysis_jobs.status = 'complete' then 'complete'
        when sequence_analysis_jobs.status = 'processing'
          then sequence_analysis_jobs.stage
        when sequence_analysis_jobs.stage in ('analysis','claims','gap')
          then sequence_analysis_jobs.stage
        else 'queued'
      end,
      available_at = case
        when sequence_analysis_jobs.status in ('complete','processing')
          then sequence_analysis_jobs.available_at
        else clock_timestamp()
      end,
      attempt_count = case
        when sequence_analysis_jobs.status = 'dead' then 0
        else sequence_analysis_jobs.attempt_count
      end,
      lease_until = case
        when sequence_analysis_jobs.status = 'processing'
          then sequence_analysis_jobs.lease_until
        else null
      end,
      worker_id = case
        when sequence_analysis_jobs.status = 'processing'
          then sequence_analysis_jobs.worker_id
        else null
      end,
      last_error_code = case
        when sequence_analysis_jobs.status in ('complete','processing')
          then sequence_analysis_jobs.last_error_code
        else null
      end
  returning id into v_job_id;

  return v_job_id;
end;
$function$;

create or replace function public.claim_sequence_analysis_job(
  p_worker_id uuid,
  p_lease_seconds integer,
  p_user_id uuid
)
returns table (
  job_id uuid,
  user_id uuid,
  sequence_id uuid,
  memory_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job public.sequence_analysis_jobs%rowtype;
  v_updated integer;
begin
  if p_worker_id is null or p_lease_seconds not between 60 and 1800 then
    raise exception 'invalid worker lease request' using errcode = '22023';
  end if;

  loop
    select job.* into v_job
    from public.sequence_analysis_jobs job
    where (
      (
        job.status in ('queued','retry_wait')
        and job.available_at <= clock_timestamp()
      ) or (
        job.status = 'processing'
        and job.lease_until < clock_timestamp()
      )
    )
      and job.attempt_count < job.max_attempts
      and (p_user_id is null or job.user_id = p_user_id)
    order by job.available_at, job.created_at
    for update skip locked
    limit 1;

    if not found then
      return;
    end if;

    if exists (
      select 1 from public.media_sequences sequence
      where sequence.id = v_job.sequence_id
        and sequence.user_id = v_job.user_id
        and sequence.analysis_status = 'complete'
    ) then
      update public.sequence_analysis_jobs
      set status = 'complete', stage = 'complete', lease_until = null,
          worker_id = null, last_error_code = null
      where id = v_job.id;
      continue;
    end if;

    update public.media_sequences as media_sequence
    set analysis_status = 'processing',
        analysis_lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        analysis_attempt_count = least(20, analysis_attempt_count + 1)
    where media_sequence.id = v_job.sequence_id
      and media_sequence.user_id = v_job.user_id
      and media_sequence.status <> 'deleted'
      and media_sequence.analysis_status <> 'complete'
      and (
        media_sequence.analysis_status in ('pending','failed')
        or (
          media_sequence.analysis_status = 'processing'
          and media_sequence.analysis_lease_until < clock_timestamp()
        )
      );
    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      update public.sequence_analysis_jobs
      set status = 'retry_wait',
          available_at = clock_timestamp() + interval '30 seconds',
          lease_until = null, worker_id = null,
          last_error_code = 'sequence_not_claimable'
      where id = v_job.id;
      continue;
    end if;

    update public.media_assets asset
    set analysis_status = 'processing'
    where asset.user_id = v_job.user_id
      and asset.analysis_status <> 'complete'
      and exists (
        select 1 from public.sequence_assets link
        where link.user_id = v_job.user_id
          and link.sequence_id = v_job.sequence_id
          and link.asset_id = asset.id
      );

    update public.sequence_analysis_jobs as analysis_job
    set status = 'processing',
        stage = case
          when analysis_job.stage in ('claims','gap') then analysis_job.stage
          else 'analysis'
        end,
        attempt_count = analysis_job.attempt_count + 1,
        lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        worker_id = p_worker_id,
        last_error_code = null
    where analysis_job.id = v_job.id
    returning analysis_job.* into v_job;

    job_id := v_job.id;
    user_id := v_job.user_id;
    sequence_id := v_job.sequence_id;
    memory_id := v_job.memory_id;
    attempt_count := v_job.attempt_count;
    return next;
    return;
  end loop;
end;
$function$;

create or replace function public.finish_sequence_analysis_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_succeeded boolean,
  p_error_code text,
  p_retry_delay_seconds integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job public.sequence_analysis_jobs%rowtype;
  v_status text;
begin
  if p_retry_delay_seconds not between 0 and 86400 then
    raise exception 'invalid retry delay' using errcode = '22023';
  end if;

  select * into v_job
  from public.sequence_analysis_jobs
  where id = p_job_id and worker_id = p_worker_id and status = 'processing'
  for update;
  if not found then
    raise exception 'owned processing job not found' using errcode = 'P0002';
  end if;

  if p_succeeded then
    v_status := 'complete';
    update public.sequence_analysis_jobs
    set status = 'complete', stage = 'complete', lease_until = null,
        worker_id = null, last_error_code = null
    where id = v_job.id;
  elsif v_job.attempt_count < v_job.max_attempts then
    v_status := 'retry_wait';
    update public.sequence_analysis_jobs
    set status = 'retry_wait',
        available_at = clock_timestamp() + make_interval(secs => p_retry_delay_seconds),
        lease_until = null, worker_id = null,
        last_error_code = left(coalesce(nullif(p_error_code, ''), 'analysis_failed'), 120)
    where id = v_job.id;
  else
    v_status := 'dead';
    update public.sequence_analysis_jobs
    set status = 'dead', lease_until = null, worker_id = null,
        last_error_code = left(coalesce(nullif(p_error_code, ''), 'analysis_failed'), 120)
    where id = v_job.id;
  end if;

  update public.media_sequences
  set analysis_status = case
        when v_status = 'complete' then 'complete'
        when v_status = 'retry_wait' then 'processing'
        else 'failed'
      end,
      analysis_lease_until = case
        when v_status = 'retry_wait'
          then clock_timestamp() + make_interval(secs => p_retry_delay_seconds)
        else null
      end
  where id = v_job.sequence_id and user_id = v_job.user_id;

  update public.media_assets asset
  set analysis_status = case
    when v_status = 'complete' then 'complete'
    when v_status = 'retry_wait' then 'processing'
    else 'failed'
  end
  where asset.user_id = v_job.user_id
    and exists (
      select 1 from public.sequence_assets link
      where link.user_id = v_job.user_id
        and link.sequence_id = v_job.sequence_id
        and link.asset_id = asset.id
    );

  return v_status;
end;
$function$;

comment on column public.sequence_analysis_jobs.stage is
  'Earliest unfinished durable pipeline stage; preserved across retry and lease recovery.';

revoke all on function public.enqueue_sequence_analysis_job(uuid,uuid,uuid)
from public, anon, authenticated;
revoke all on function public.claim_sequence_analysis_job(uuid,integer,uuid)
from public, anon, authenticated;
revoke all on function public.finish_sequence_analysis_job(uuid,uuid,boolean,text,integer)
from public, anon, authenticated;

grant execute on function public.enqueue_sequence_analysis_job(uuid,uuid,uuid)
to service_role;
grant execute on function public.claim_sequence_analysis_job(uuid,integer,uuid)
to service_role;
grant execute on function public.finish_sequence_analysis_job(uuid,uuid,boolean,text,integer)
to service_role;
