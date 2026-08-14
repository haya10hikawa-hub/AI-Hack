# Re:Memory Supabase

This directory is the database, authorization, provenance, cost-control, and
private-object boundary for Re:Memory.

## Apply locally

With Docker and the Supabase CLI installed:

```bash
supabase start
supabase db reset
supabase test db
```

The migration is safe to apply to a fresh project. `seed.sql` deliberately does
not create people, photos, evidence, claims, or memories. Tests create isolated
transactional fixtures and roll them back.

Run dependency-free static checks even when PostgreSQL/Docker is unavailable:

```bash
node supabase/tests/static-schema.test.mjs
```

## Storage contract

`rememory-private` is never public. The only accepted object names are:

```text
{authenticated-user-id}/assets/{asset-id}/original
{authenticated-user-id}/assets/{asset-id}/vision.webp
```

Only short-lived signed URLs should be returned by server routes. Do not log
object URLs. Remove both objects before calling `finalize_memory_deletion`.

## Transaction RPC contracts

`claim_sequence_analysis(owner, sequence, representative_asset_ids,
lease_seconds) -> boolean` atomically leases pending/failed/stale work. The
asset list must exactly equal the persisted representative set. Always finish
with `complete_sequence_analysis(owner, sequence, complete|failed|not_supported)`;
it clears the lease and synchronizes every sequence asset's terminal state.

New ingestion uses the durable queue RPCs below. The older direct Sequence
lease remains available for migration compatibility but should not be used by
new worker code.

- `enqueue_sequence_analysis_job(owner, sequence, memory) -> job uuid`
- `claim_sequence_analysis_job(worker, lease_seconds, optional_owner) -> job row`
- `touch_sequence_analysis_job(job, worker, stage, lease_seconds) -> boolean`
- `finish_sequence_analysis_job(job, worker, succeeded, error_code, retry_delay) -> status`

Claim uses `FOR UPDATE SKIP LOCKED`, updates the Sequence and its assets in the
same transaction, and can recover an expired processing lease. `optional_owner`
is null for the scheduled worker and the verified session owner for the Home
resume endpoint. Failed jobs use exponential backoff and become `dead` only
after the persisted maximum attempt count.

`create_evidence_backed_claim(owner, memory, field, value, origin, confidence,
evidence_ids, ai_run, dedupe_key, activate := true) -> claim uuid` validates
owner, evidence membership, AI-run provenance, exact-location minimization, and
idempotency. Pass `activate := false` for a provisional Memory Gap candidate.

`apply_memory_gap_correction(owner, gap, action, value, field, idempotency_key)` locks
the exact gap-bound candidate, appends a `user_corrections` row, creates a new
user-origin claim, handles user/user conflict as `disputed`, and resolves the
gap atomically. `apply_user_correction` is the lower-level correction RPC for a
known memory/claim pair.

Deletion is two-phase and retryable:

1. `request_memory_deletion(owner, memory) -> boolean` moves it to `deleting`, which
   immediately removes it from normal retrieval.
2. The authenticated server removes original and derivative Storage objects.
3. `finalize_memory_deletion(owner, memory) -> boolean` verifies no objects remain and
   cascades the event, memory, evidence, claims, corrections, and sequence.

AI gates are shared and race-safe:

- `consume_ai_rate_limit(owner, key, window_started_at_ms, expires_at_ms) -> count`
- `reserve_ai_cost(owner, purpose, day, estimate, daily_limit) -> reservation uuid/null`
- `commit_ai_cost(owner, reservation, actual_cost)`
- `release_ai_cost(owner, reservation)`

All mutation RPCs are executable only by `service_role`. The server supplies the
owner ID it obtained from `auth.getUser()`; routes must never accept it from the
request payload.

## Trust boundary

RLS isolates users, while constraints and RPCs protect provenance. A production
deployment should use a server-only Supabase secret client for ingestion graph
writes and expose only user-scoped reads and the narrow RPCs to the browser.
Never ship the secret/service-role key to client JavaScript. Every privileged
server write must derive `user_id` from a freshly verified Supabase user rather
than accepting an owner ID from the request body.
