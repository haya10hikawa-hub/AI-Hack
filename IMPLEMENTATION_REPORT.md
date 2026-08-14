# Re:Memory Implementation Report

Date: 2026-08-14

Branch: `codex/final-product-completion`

## Final Status

The defined AI HACK 2026 web MVP is code-complete. The production path uses
real Supabase Auth/PostgreSQL/Private Storage and a server-only
OrcaRouter-compatible AI provider; it contains no demo backend or hard-coded
Hero answer. The final hosted release still requires project credentials and a
live deployment, which are intentionally not committed or simulated.

## Completed

- Cookie-backed authentication, email confirmation, password reset, sign-out
- Private image upload with byte/type/decode/dimension validation and SHA dedupe
- EXIF normalization, coarse-place minimization, stripped WebP derivatives
- Deterministic Temporal Sequence, Event, Evidence, Memory, importance/context
- Durable AI jobs with lease, heartbeat, bounded retry, dead state, and recovery
- Durable stage checkpoints: retry resumes at `claims` or `gap` without Vision
- User-visible failed-analysis retry from Home and Memory Detail; no re-upload
- Evidence-backed AI Claims, conservative Memory Gap gate, atomic correction
- User-origin confirmed Claim and provenance-backed natural-language recall
- Structured filtering, AI rerank, ambiguity/unknown gates, explicit feedback
- Memory Thread, detail/provenance, confirmation, search, privacy/account UI
- Complete Memory/account deletion and portable JSON account export
- Health endpoint, scheduled worker, live Hero smoke command, production runbook
- Re:Memory app icon, responsive states, keyboard/focus/reduced-motion support

## Not Completed

No required MVP code path is knowingly missing. These external release actions
could not be executed without user-owned credentials:

- deploy and configure a hosted Supabase project;
- configure a real OrcaRouter endpoint/key/model IDs;
- configure production Auth email redirects and `APP_ORIGIN`;
- deploy to Vercel and register the real monitoring destination;
- run the real approved-photo Hero smoke and record provider latency;
- force-stop a real provider run at `claims`/`gap` and measure lease recovery.

Calendar OAuth, people enrichment, camera-roll sync, video analysis, native apps,
sharing/social, and push notifications remain explicit post-MVP roadmap items.

## Architecture

```text
Next.js UI / Route Handlers
        ↓ verified user session
Supabase Auth + service-role owner-scoped writes
        ↓
PostgreSQL / Private Storage / durable analysis jobs
        ↓
typed server-only AI adapter + schema/provenance/cost gates
```

`src/domain` owns deterministic truth and eligibility rules. `src/server` owns
Supabase, ingestion, jobs, AI, and retrieval orchestration. `src/components`
renders typed API payloads and honest loading/partial/failed/unknown states.

## AI Pipeline

```text
queued analysis
→ privacy-safe Vision observations
→ durable checkpoint: claims
→ evidence-backed Claims
→ durable checkpoint: gap
→ gated provisional Claim + Memory Gap
→ complete
```

The checkpoint column is the earliest unfinished stage. Retry and expired-lease
reclaim preserve it. A `claims`/`gap` resume does not download a derivative or
repeat Vision. Stable Evidence/Claim/Gap dedupe keys keep partial retries
idempotent. AI output is schema-validated and cannot authorize, delete, or write
arbitrary state.

## Database / Migrations

- `202608130001_initial_rememory.sql`: owner graph, invariants, RLS, storage, RPCs
- `202608140002_durable_sequence_analysis_jobs.sql`: queue/lease/retry/dead state
- `202608140003_product_completion.sql`: search feedback and coarse-place cache
- `202608140004_analysis_job_checkpoints.sql`: resumable stage semantics

All four migrations apply from a clean local PostgreSQL database. Browser roles
are read-only for provenance/domain rows; trusted writes derive `user_id` from a
verified session and use owner-scoped service-role queries/RPCs.

## Security Review

- RLS on every private table and private owner-prefixed Storage
- server-only secret and AI credentials
- same-origin mutation checks and security headers/CSP
- upload magic-byte/decode/pixel/size checks and per-user duplicate handling
- AI rate/cost reservations, bounded responses/timeouts, structured outputs
- retrieval excludes deleted/superseded/rejected/disputed/unsupported content
- correction and deletion are atomic/idempotent at their DB boundary

The remaining security work is deployment assurance against the actual hosted
project, not a known unpatched critical code vulnerability.

## Privacy Review

Exact GPS, raw EXIF, original filenames, signed URLs, raw prompts/answers, and
private image content are not written to AI audit rows. External Vision receives
only resized metadata-stripped derivatives and minimized context. Manual place
labels are stored as user-confirmed provenance, not deterministic metadata.

## AI Cost

Representative selection limits Vision images to four per Sequence. Upload AI
uses an eight-second default stage timeout and no provider retry inside the
60-second route budget; durable jobs provide application retry. Cost/rate gates
reserve before calls and settle actual usage. Checkpoint recovery prevents
repeating the most expensive Vision stage after downstream failure.

## Test Results

The final release gate is:

```bash
pnpm verify
pnpm test:e2e
pnpm dlx supabase@latest db reset
pnpm dlx supabase@latest test db
```

Current local results are recorded in `docs/PRODUCT_COMPLETION_REPORT.md`.
Playwright uses isolated API fixtures; the credential-gated real-service flow is
available as `pnpm test:live:hero` and never falls back to fake production data.

## Visual / UX Review

The rendered landing page and mobile/desktop critical flows were browser-tested
against the Memory Editorial rules. Filled/open nodes and solid/dotted lines
distinguish Evidence/user confirmation from AI inference without relying on
color. Failed reconstruction now explains that photos remain saved and exposes
a 44px+ retry action. The final browser pass had no application console errors.

## Assumptions

- The outer repository is canonical; the ignored nested clone remains untouched.
- Confirm stays a Home entry point, not a permanent navigation destination.
- Calendar/people sources remain disconnected until a provider and consent model
  are selected; no fake source is shown.
- A production operator supplies credentials, redirects, approved test photos,
  and the deployment plan.

## Product Open Questions

- Which calendar provider and retention/deletion policy should be supported?
- Whether post-MVP people/relationship context is valuable enough to ask about.
- Whether the production plan should run the worker more often than the checked-in
  Vercel Hobby-compatible daily recovery schedule.

## Technical Debt

- The first `after()` worker kick is still bounded by the route `maxDuration`;
  durability comes from PostgreSQL queue recovery, not `after()` itself.
- The live 20-second/35-second performance target depends on the selected AI
  provider and must be measured after deployment.
- Calendar and people enrichment are intentionally absent from claim inputs.

## Known Issues

- Without external Supabase/AI configuration, private routes return an honest
  recoverable configuration error and cannot demonstrate the live Hero Flow.
- A Hobby-compatible daily cron is only a last-resort recovery path; normal work
  is started after upload and resumed while Home is open.

## Next Actions

1. Configure hosted credentials and apply all migrations.
2. Run `pnpm test:live:hero` with a dedicated confirmed account and approved
   10-photo set; attach the JSON timing output to GitHub issue #3.
3. Force-stop a run after `claims`/`gap`, wait for lease expiry, invoke the worker,
   and attach no-repeat-Vision evidence to issue #4.
4. Deploy, verify `/api/health`, and close issue #6 after the production smoke.
5. Treat issue #8 as roadmap unless the product owner explicitly promotes it.
