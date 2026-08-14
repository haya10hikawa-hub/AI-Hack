# Re:Memory Product Completion Report

Date: 2026-08-14

Branch: `codex/product-completion`

## Outcome

The repository is code-complete for the defined web MVP. The core flow is no
longer a UI prototype: Auth, private Storage, deterministic ingestion, durable
AI jobs, evidence-backed claims, confirmation, grounded search, account
lifecycle, and explicit search learning have server and database paths.

Production activation still requires real Supabase, AI provider, and hosting
credentials. Those credentials are intentionally not committed.

## Completed in this phase

- Durable analysis jobs from PR #16 and Event/search design from PR #15 merged
- Password recovery, email-confirmation resend, and password update
- JSON account export with paginated rows and one-hour media download links
- Full account deletion: private media, database graph, then Auth account
- Explicit opt-in search feedback and exact-query reranking
- Search-learning history deletion when the setting is disabled
- Optional coarse reverse geocoding from an approximately 10 km grid center
- Service-role database grants required by trusted Next.js mutation routes
- Public `/api/health` readiness endpoint without secret values
- Node 24-compatible GitHub Actions and mandatory formatting gate
- Stable single-worker mobile/desktop Playwright execution
- Product decisions and production operations runbooks

## Verification evidence

- `pnpm verify`: format, ESLint, strict TypeScript, 84 Vitest tests, production build
- `pnpm test:e2e`: 14/14 mobile and desktop Playwright cases
- `supabase db reset`: all three migrations applied from a clean database
- `supabase test db`: 74 pgTAP assertions passed
- Live local Supabase test without API mocks:
  - sign-up and cookie session succeeded
  - privacy/search-learning setting persisted
  - explicit search feedback was stored
  - disabling learning reduced feedback rows to zero
  - account export returned HTTP 200 with account, Memory, and feedback data
  - account deletion returned success and the next `/api/auth/me` returned 401
  - `/api/health` returned HTTP 200 after complete configuration

Playwright Hero Flow uses mocked external APIs by design. It does not prove a
real hosted AI provider's latency or availability.

## External activation still required

1. Configure a hosted Supabase project and apply migrations.
2. Configure a real OrcaRouter-compatible provider and model IDs.
3. Deploy to Vercel, set `APP_ORIGIN` and `CRON_SECRET`, and verify `/api/health`.
4. Run the live 10-photo Hero Flow and record the 20-second first-Event and
   35-second terminal-analysis targets.
5. Kill the process during a real multi-sequence AI run and confirm the durable
   worker resumes it without duplicate Evidence, Claims, or gaps.
6. Optionally configure `GEOCODER_API_BASE_URL`; manual coarse-place input remains
   available when no provider is configured.

These are deployment/credential checks, not missing fallback code. See
[`PRODUCTION_RUNBOOK.md`](./PRODUCTION_RUNBOOK.md).

## Roadmap, not MVP blockers

- Calendar OAuth/connectors and calendar-derived Evidence
- People/relationship enrichment after explicit opt-in
- Automatic camera-roll/background sync
- Native mobile apps, video analysis, push notifications, and payments

## GitHub issue disposition

- #5, #7, #9, #10, #11, #13: implemented by the product-completion change
- #3, #6: keep open until real hosted credentials and deployment are available
- #4: durable implementation complete; keep open only for the real-provider
  forced-process-exit acceptance test
- #8: keep as a post-MVP calendar connector roadmap item
