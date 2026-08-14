begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, pg_catalog;
select no_plan();

-- Schema and RLS coverage.
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'user_preferences', 'user_preferences exists');
select has_table('public', 'media_assets', 'media_assets exists');
select has_table('public', 'media_sequences', 'media_sequences exists');
select has_table('public', 'sequence_assets', 'sequence_assets exists');
select has_table('public', 'events', 'events exists');
select has_table('public', 'evidence', 'evidence exists');
select has_table('public', 'memories', 'memories exists');
select has_table('public', 'claims', 'claims exists');
select has_table('public', 'claim_evidence', 'claim_evidence exists');
select has_table('public', 'user_corrections', 'user_corrections exists');
select has_table('public', 'memory_context_dimensions', 'memory_context_dimensions exists');
select has_table('public', 'memory_gaps', 'memory_gaps exists');
select has_table('public', 'memory_relations', 'memory_relations exists');
select has_table('public', 'personal_context', 'personal_context exists');
select has_table('public', 'ai_runs', 'ai_runs exists');
select has_table('public', 'ai_rate_limits', 'ai_rate_limits exists');
select has_table('public', 'ai_daily_budgets', 'ai_daily_budgets exists');
select has_table('public', 'ai_cost_reservations', 'ai_cost_reservations exists');
select has_table('public', 'sequence_analysis_jobs', 'sequence_analysis_jobs exists');
select has_table('public', 'search_feedback', 'search_feedback exists');
select has_table('public', 'coarse_location_labels', 'coarse location label cache exists');

select ok(
  not exists (
    select 1
    from (values
      ('profiles'), ('user_preferences'), ('media_assets'), ('media_sequences'),
      ('sequence_assets'), ('events'), ('evidence'), ('memories'), ('claims'),
      ('claim_evidence'), ('user_corrections'), ('memory_context_dimensions'),
      ('memory_gaps'), ('memory_relations'), ('personal_context'), ('ai_runs'),
      ('ai_rate_limits'), ('ai_daily_budgets'), ('ai_cost_reservations'),
      ('sequence_analysis_jobs'), ('search_feedback'), ('coarse_location_labels')
    ) required(table_name)
    left join pg_class table_class
      on table_class.relname = required.table_name
     and table_class.relnamespace = 'public'::regnamespace
    where not coalesce(table_class.relrowsecurity, false)
  ),
  'RLS is enabled on every private table'
);

select col_is_null('public', 'media_assets', 'captured_at', 'captured_at stays nullable');
select has_column('public', 'media_assets', 'coarse_place', 'coarse place exists');
select hasnt_column('public', 'media_assets', 'latitude', 'exact latitude is absent');
select hasnt_column('public', 'media_assets', 'longitude', 'exact longitude is absent');
select hasnt_column('public', 'media_assets', 'exact_lat', 'exact_lat is absent');
select hasnt_column('public', 'media_assets', 'exact_lng', 'exact_lng is absent');
select has_column('public', 'user_preferences', 'use_personal_context', 'personal context preference exists');
select has_column('public', 'memory_gaps', 'target_claim_id', 'gap target claim exists');
select has_column('public', 'memory_gaps', 'candidate_value_json', 'gap candidate value exists');
select has_column('public', 'memory_gaps', 'deferred_until', 'gap deferral exists');
select has_column('public', 'user_corrections', 'created_claim_id', 'correction result claim exists');

select has_function(
  'public', 'create_evidence_backed_claim',
  array['uuid','uuid','text','jsonb','text','text','uuid[]','uuid','text','boolean']
);
select has_function(
  'public', 'claim_sequence_analysis', array['uuid','uuid','uuid[]','integer']
);
select has_function(
  'public', 'complete_sequence_analysis', array['uuid','uuid','text']
);
select has_function(
  'public', 'enqueue_sequence_analysis_job', array['uuid','uuid','uuid']
);
select has_function(
  'public', 'claim_sequence_analysis_job', array['uuid','integer','uuid']
);
select has_function(
  'public', 'touch_sequence_analysis_job', array['uuid','uuid','text','integer']
);
select has_function(
  'public', 'finish_sequence_analysis_job', array['uuid','uuid','boolean','text','integer']
);
select has_function(
  'public', 'apply_user_correction',
  array['uuid','uuid','uuid','text','jsonb','text','uuid']
);
select has_function(
  'public', 'apply_memory_gap_correction',
  array['uuid','uuid','text','jsonb','text','uuid']
);
select has_function('public', 'request_memory_deletion', array['uuid','uuid']);
select has_function('public', 'finalize_memory_deletion', array['uuid','uuid']);
select has_function('public', 'consume_ai_rate_limit', array['uuid','text','bigint','bigint']);
select has_function('public', 'reserve_ai_cost', array['uuid','text','date','numeric','numeric']);
select has_function('public', 'commit_ai_cost', array['uuid','uuid','numeric']);
select has_function('public', 'release_ai_cost', array['uuid','uuid']);

select is(
  (select public from storage.buckets where id = 'rememory-private'),
  false,
  'media bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'rememory-private'),
  20971520::bigint,
  'bucket enforces the 20 MiB ceiling'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'rememory_storage_%'),
  1,
  'authenticated storage access is read-only'
);

-- Provision two isolated users; the auth trigger creates profiles/preferences.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'rls-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"RLS A"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'rls-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"RLS B"}',
   now(), now(), '', '', '', '');

select is(
  (select count(*)::integer from public.profiles
   where id in ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),
  2,
  'auth trigger creates profiles'
);
select is(
  (select count(*)::integer from public.user_preferences
   where user_id in ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),
  2,
  'auth trigger creates preferences'
);

-- Minimal owner-A graph, inserted as migration owner to isolate policy tests.
insert into public.media_assets (
  id, user_id, media_type, mime_type, storage_key, derivative_storage_key,
  sha256, bytes, width, height, extraction_status, analysis_status
) values (
  'a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'image', 'image/jpeg',
  '10000000-0000-4000-8000-000000000001/assets/a0000000-0000-4000-8000-000000000001/original',
  '10000000-0000-4000-8000-000000000001/assets/a0000000-0000-4000-8000-000000000001/vision.webp',
  repeat('a', 64), 128, 10, 10, 'complete', 'complete'
);
insert into public.media_sequences (id, user_id, status)
values ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active');
insert into public.sequence_assets (user_id, sequence_id, asset_id, is_representative)
values (
  '10000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001', true
);
insert into public.events (id, user_id, sequence_id, status)
values (
  'e0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'active'
);
insert into public.memories (id, user_id, event_id, title, status)
values (
  'b0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', 'Private memory', 'active'
);
insert into public.evidence (
  id, user_id, event_id, asset_id, kind, field, value_json, source_type
) values (
  'd0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'metadata_observation', 'time', '{"value":"2026-04-12"}', 'metadata'
);

set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.memories), 0, 'user B cannot read user A memory');
select is((select count(*)::integer from public.evidence), 0, 'user B cannot read user A evidence');
select is(
  has_function_privilege(
    'authenticated',
    'public.create_evidence_backed_claim(uuid,uuid,text,jsonb,text,text,uuid[],uuid,text,boolean)',
    'EXECUTE'
  ),
  false,
  'browser role cannot execute the claim mutation RPC'
);
select throws_ok(
  $$insert into public.evidence (
      user_id, event_id, kind, field, value_json, source_type
    ) values (
      '20000000-0000-4000-8000-000000000002',
      'e0000000-0000-4000-8000-000000000001',
      'fabricated', 'activity', '{"value":"fabricated"}', 'ai_observation'
    )$$,
  '42501', 'permission denied for table evidence', 'browser role cannot fabricate evidence'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.memories), 1, 'owner can read own memory');
reset role;
set local role service_role;
select lives_ok(
  $$select public.enqueue_sequence_analysis_job(
      '10000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001'
    )$$,
  'service worker can enqueue an owned sequence'
);
select is(
  (select count(*)::integer from public.claim_sequence_analysis_job(
    '30000000-0000-4000-8000-000000000003', 300,
    '10000000-0000-4000-8000-000000000001'
  )),
  1,
  'one worker atomically claims a queued sequence'
);
select is(
  (select count(*)::integer from public.claim_sequence_analysis_job(
    '40000000-0000-4000-8000-000000000004', 300, null
  )),
  0,
  'a live lease prevents a second worker claim'
);
select is(
  public.touch_sequence_analysis_job(
    public.enqueue_sequence_analysis_job(
      '10000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001'
    ),
    '30000000-0000-4000-8000-000000000003', 'claims', 300
  ),
  true,
  'the owning worker advances the durable stage and lease'
);
select is(
  public.finish_sequence_analysis_job(
    public.enqueue_sequence_analysis_job(
      '10000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001'
    ),
    '30000000-0000-4000-8000-000000000003', false, 'test_failure', 0
  ),
  'retry_wait',
  'a retryable failure remains durable'
);
reset role;
select is(
  (select analysis_status from public.media_sequences
    where id = 'a1000000-0000-4000-8000-000000000001'),
  'processing',
  'retry wait remains visible as processing to keep client recovery active'
);
set local role service_role;
select lives_ok(
  $$select public.enqueue_sequence_analysis_job(
      '10000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001'
    )$$,
  're-enqueue makes retryable work immediately available'
);
select is(
  (select count(*)::integer from public.claim_sequence_analysis_job(
    '50000000-0000-4000-8000-000000000005', 300,
    '10000000-0000-4000-8000-000000000001'
  )),
  1,
  'retry work can be reclaimed'
);
select is(
  public.finish_sequence_analysis_job(
    public.enqueue_sequence_analysis_job(
      '10000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001'
    ),
    '50000000-0000-4000-8000-000000000005', true, null, 0
  ),
  'complete',
  'successful retry reaches the terminal state'
);
reset role;
select is(
  (select analysis_status from public.media_sequences
    where id = 'a1000000-0000-4000-8000-000000000001'),
  'complete',
  'successful retry synchronizes the Sequence terminal state'
);
set local role service_role;
select throws_ok(
  $$select public.create_evidence_backed_claim(
      '10000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001', 'location',
      '{"latitude":35.0,"longitude":135.0}', 'deterministic', 'high',
      array['d0000000-0000-4000-8000-000000000001'::uuid], null, 'exact-gps', true
    )$$,
  '22023', 'invalid claim value', 'exact location cannot enter claim JSON'
);
select lives_ok(
  $$select public.create_evidence_backed_claim(
      '10000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001', 'time', '{"value":"2026-04-12"}',
      'deterministic', 'high', array['d0000000-0000-4000-8000-000000000001'::uuid],
      null, 'owner-time', true
    )$$,
  'owner can create an evidence-backed deterministic claim'
);
select throws_ok(
  $$select public.create_evidence_backed_claim(
      '10000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001', 'activity', '{"value":"guess"}',
      'ai', 'medium', array['d0000000-0000-4000-8000-000000000001'::uuid],
      null, 'missing-ai-run', true
    )$$,
  '23514', 'AI claims require AI run provenance', 'AI claim requires AI-run provenance'
);
select cmp_ok(
  public.consume_ai_rate_limit(
    '10000000-0000-4000-8000-000000000001', 'test', 4102444790000, 4102444800000
  ), '=', 1::bigint,
  'rate limit starts atomically at one'
);
select cmp_ok(
  public.consume_ai_rate_limit(
    '10000000-0000-4000-8000-000000000001', 'test', 4102444790000, 4102444800000
  ), '=', 2::bigint,
  'rate limit atomically increments'
);

reset role;
select * from finish();
rollback;
