begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, pg_catalog;
select no_plan();

-- Schema and RLS coverage.
select has_table('public', 'profiles');
select has_table('public', 'user_preferences');
select has_table('public', 'media_assets');
select has_table('public', 'media_sequences');
select has_table('public', 'sequence_assets');
select has_table('public', 'events');
select has_table('public', 'evidence');
select has_table('public', 'memories');
select has_table('public', 'claims');
select has_table('public', 'claim_evidence');
select has_table('public', 'user_corrections');
select has_table('public', 'memory_context_dimensions');
select has_table('public', 'memory_gaps');
select has_table('public', 'memory_relations');
select has_table('public', 'personal_context');
select has_table('public', 'ai_runs');
select has_table('public', 'ai_rate_limits');
select has_table('public', 'ai_daily_budgets');
select has_table('public', 'ai_cost_reservations');

select ok(
  not exists (
    select 1
    from (values
      ('profiles'), ('user_preferences'), ('media_assets'), ('media_sequences'),
      ('sequence_assets'), ('events'), ('evidence'), ('memories'), ('claims'),
      ('claim_evidence'), ('user_corrections'), ('memory_context_dimensions'),
      ('memory_gaps'), ('memory_relations'), ('personal_context'), ('ai_runs'),
      ('ai_rate_limits'), ('ai_daily_budgets'), ('ai_cost_reservations')
    ) required(table_name)
    left join pg_class table_class
      on table_class.relname = required.table_name
     and table_class.relnamespace = 'public'::regnamespace
    where not coalesce(table_class.relrowsecurity, false)
  ),
  'RLS is enabled on every private table'
);

select col_is_null('public', 'media_assets', 'captured_at');
select has_column('public', 'media_assets', 'coarse_place');
select hasnt_column('public', 'media_assets', 'latitude');
select hasnt_column('public', 'media_assets', 'longitude');
select hasnt_column('public', 'media_assets', 'exact_lat');
select hasnt_column('public', 'media_assets', 'exact_lng');
select has_column('public', 'user_preferences', 'use_personal_context');
select has_column('public', 'memory_gaps', 'target_claim_id');
select has_column('public', 'memory_gaps', 'candidate_value_json');
select has_column('public', 'memory_gaps', 'deferred_until');
select has_column('public', 'user_corrections', 'created_claim_id');

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
insert into public.sequence_assets (user_id, sequence_id, asset_id)
values (
  '10000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001'
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
