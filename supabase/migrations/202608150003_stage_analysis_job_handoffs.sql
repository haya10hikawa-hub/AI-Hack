-- A Vercel Function has a 60 second execution ceiling. Hand completed AI
-- stages back to the durable queue so every invocation performs at most one
-- provider call and a killed invocation becomes reclaimable quickly.

create or replace function public.advance_sequence_analysis_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_next_stage text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job public.sequence_analysis_jobs%rowtype;
begin
  if p_next_stage not in ('claims', 'gap') then
    raise exception 'invalid next analysis stage' using errcode = '22023';
  end if;

  select * into v_job
  from public.sequence_analysis_jobs
  where id = p_job_id and worker_id = p_worker_id and status = 'processing'
  for update;
  if not found then
    return false;
  end if;
  if not (
    (v_job.stage = 'analysis' and p_next_stage = 'claims')
    or (v_job.stage = 'claims' and p_next_stage = 'gap')
  ) then
    raise exception 'invalid analysis stage transition' using errcode = '22023';
  end if;

  update public.sequence_analysis_jobs
  set status = 'queued',
      stage = p_next_stage,
      available_at = clock_timestamp(),
      attempt_count = greatest(0, attempt_count - 1),
      lease_until = null,
      worker_id = null,
      last_error_code = null
  where id = v_job.id;

  update public.media_sequences
  set analysis_status = 'pending', analysis_lease_until = null
  where id = v_job.sequence_id and user_id = v_job.user_id
    and analysis_status = 'processing';

  update public.media_assets asset
  set analysis_status = 'pending'
  where asset.user_id = v_job.user_id
    and asset.analysis_status <> 'complete'
    and exists (
      select 1 from public.sequence_assets link
      where link.user_id = v_job.user_id
        and link.sequence_id = v_job.sequence_id
        and link.asset_id = asset.id
    );

  return true;
end;
$function$;

revoke all on function public.advance_sequence_analysis_job(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.advance_sequence_analysis_job(uuid,uuid,text)
to service_role;

