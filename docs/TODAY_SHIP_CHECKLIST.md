# Re:Memory Today Ship Checklist

Date: 2026-08-14

This checklist is ordered for the remaining work before submission. The code MVP
is already implemented; the critical path is production configuration and live
proof with real services.

## Priority Order

| Priority | Work item                            | Finish today?                 | Needs                                              |
| -------- | ------------------------------------ | ----------------------------- | -------------------------------------------------- |
| P0       | Hosted Supabase setup and migrations | Yes, if access exists         | Supabase project, DB password, CLI login/link      |
| P0       | Production AI provider configuration | Yes, if key/model IDs exist   | OrcaRouter-compatible base URL, API key, model IDs |
| P0       | Vercel production deploy             | Yes, if project access exists | Vercel project, env vars, production domain        |
| P0       | `/api/health` production check       | Yes after deploy              | Deployed URL                                       |
| P0       | Live 10-photo Hero Flow              | Yes after deploy              | Confirmed test account, approved photo directory   |
| P0       | Submission evidence                  | Partially today               | Screenshots, live smoke JSON, issue comments       |
| P1       | Real forced-stop recovery acceptance | After live deploy             | Process kill/restart access, provider logs         |
| P1       | Calendar connector                   | No                            | OAuth, consent, retention policy                   |
| P1       | People/relationship enrichment       | No                            | Explicit opt-in model and privacy review           |
| P2       | Camera-roll sync                     | No                            | Native/background permission design                |
| P2       | Video analysis                       | No                            | Cost, queue, storage, and UX design                |
| P2       | Native apps                          | No                            | Separate platform scope                            |
| P2       | Push notifications                   | No                            | App/device notification infrastructure             |
| P2       | Sharing/social                       | No                            | Sharing permission and deletion semantics          |
| P3       | Billing                              | No                            | Product/package decision                           |

## Today's Realistic Scope

### Track A: credentials are available

1. Link the hosted Supabase project.
2. Apply migrations.
3. Configure production environment variables.
4. Deploy the app.
5. Verify `/api/health`.
6. Run the live Hero smoke with real approved photos.
7. Attach the live JSON output to GitHub issue #3.
8. Run the forced-stop recovery acceptance and attach evidence to issue #4.
9. Update issue #6 with deployment status.
10. Update issue #25 with the final submission checklist status.

### Track B: credentials are not available

1. Keep code changes frozen on the current PR branch.
2. Verify `.env.example` has every production key needed by Supabase, AI, Vercel,
   cron, upload limits, and optional geocoder.
3. Use this checklist and `docs/PRODUCTION_RUNBOOK.md` as the operator handoff.
4. Prepare mock E2E screenshots only as UI evidence, not as live-service proof.
5. Leave issues #3, #4, #6, and #25 open until the real production run is done.

## Exact Command Sequence

### 1. Local release gate

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
pnpm preflight:prod -- --env-file=.env.production
pnpm preflight:prod -- --env-file=.env.production --check-models
```

### 2. Supabase production migration

```bash
pnpm dlx supabase@latest login
pnpm dlx supabase@latest link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase@latest db push
pnpm dlx supabase@latest test db
```

Expected result: all migrations through `202608140006` are applied and pgTAP
passes.

### 3. Vercel production deploy

Set every required environment variable from `.env.example`, then deploy:

```bash
pnpm preflight:prod -- --env-file=.env.production
pnpm preflight:prod -- --env-file=.env.production --check-models
pnpm dlx vercel --prod
```

After deploy:

```bash
pnpm preflight:prod -- --env-file=.env.production --check-health
curl --fail-with-body https://YOUR_ORIGIN/api/health
```

Expected result: HTTP 200 and all health checks are `true`.

### 4. Live Hero smoke

```bash
LIVE_BASE_URL=https://YOUR_ORIGIN \
LIVE_HERO_EMAIL=hero-test@example.com \
LIVE_HERO_PASSWORD='your-test-password' \
LIVE_PHOTO_DIR=/absolute/path/to/approved-photos \
LIVE_COARSE_PLACE=神山 \
pnpm test:live:hero
```

Expected result: JSON output includes first Event timing, terminal analysis
timing, gap confirmation, re-search, provenance check, and cleanup.

## Model Configuration

Fill these values before production deploy:

| Variable                | Required | Notes                                                |
| ----------------------- | -------- | ---------------------------------------------------- |
| `AI_API_BASE_URL`       | Yes      | OpenAI-compatible `/v1` endpoint                     |
| `AI_API_KEY`            | Yes      | Server-only provider key                             |
| `AI_PROVIDER_NAME`      | Yes      | Use `orcarouter` unless the provider adapter changes |
| `AI_MODEL_VISION_CHEAP` | Yes      | Vision-capable model for photo observations          |
| `AI_MODEL_EVENT_CHEAP`  | Yes      | Low-cost structured event/claim model                |
| `AI_MODEL_CHAT_CHEAP`   | Yes      | Low-cost search/rerank/answer model                  |
| `AI_MODEL_EVENT_STRONG` | Yes      | Stronger fallback model for structured event work    |

These values are OrcaRouter model IDs. Use the `id` strings returned by the
provider's OpenAI-compatible `/v1/models` endpoint. For hosted OrcaRouter, the
base URL is typically `https://api.orcarouter.ai/v1`; keep the value configurable
because workspace routing can differ.

If the exact model names are not decided yet, keep these as deployment blockers.
Do not deploy with placeholder `replace-me` values.

## Submission Evidence Checklist

Collect these artifacts before calling the product ready for submission:

- Production URL
- `/api/health` HTTP 200 output
- `pnpm verify` output
- `pnpm test:e2e` output
- `supabase db push` or migration status evidence
- `supabase test db` output
- `pnpm test:live:hero` JSON output
- Mobile screenshot: Home Memory Thread
- Mobile screenshot: Gap confirmation
- Desktop screenshot: Search with grounded answer
- Short demo video: upload to recall flow
- GitHub PR link and issue status summary
