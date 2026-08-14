# Re:Memory Production Runbook

## 1. Required services

- Supabase project with Auth, Postgres, and Storage
- OrcaRouter-compatible AI endpoint and model identifiers
- Vercel project (or another Next.js 16 compatible Node.js host)
- Production browser origin such as `https://rememory.example`
- Optional Nominatim-compatible reverse-geocoding endpoint for automatic coarse locality labels

Copy `.env.example` into the deployment environment. Never place server secrets
in a `NEXT_PUBLIC_*` variable.

For the submission-day order of operations, use
[`TODAY_SHIP_CHECKLIST.md`](./TODAY_SHIP_CHECKLIST.md). It separates the work
that can finish today from post-MVP roadmap items.

When `GEOCODER_API_BASE_URL` is set, only the center of the already-quantized
approximately 10 km grid is sent. If it is unavailable, upload remains usable
and the UI accepts a manual city/municipality label.

## 2. Database and Storage

Apply every migration in order:

```bash
pnpm dlx supabase@latest db push
```

Confirm that the private `rememory-private` bucket exists and that migrations
`202608130001`, `202608140002`, `202608140003`, `202608140004`,
`202608140005`, and `202608140006` are present. The browser is read-only for
provenance data; server routes require `SUPABASE_SECRET_KEY`.

## 3. Auth URLs

In Supabase Auth URL Configuration, set:

- Site URL: the exact `APP_ORIGIN`
- Redirect URL: `${APP_ORIGIN}/auth/confirm`

Test sign-up confirmation, confirmation resend, password recovery, login, and
logout. Recovery redirects through `/auth/confirm` to
`/auth/update-password`.

## 4. Durable analysis worker

Set `CRON_SECRET` to a long random value. Vercel calls
`/api/internal/analysis-worker` with a Bearer token. The checked-in daily cron
is a recovery fallback compatible with Vercel Hobby. Upload and user navigation
also resume queued work immediately.

For faster recovery on a plan that supports it, change the schedule to every
minute. Do not remove the durable `sequence_analysis_jobs` queue when changing
the trigger.

## 5. Deploy gate

Run before every production release:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
pnpm preflight:prod -- --env-file=.env.production
pnpm preflight:prod -- --env-file=.env.production --check-models
```

After deploy, check:

```bash
pnpm preflight:prod -- --env-file=.env.production --check-health
curl --fail-with-body https://YOUR_ORIGIN/api/health
```

The response must be HTTP 200 with all three checks set to `true`.

## 6. Live Hero Flow

Use a new account and real photos. Do not reuse Playwright mock data.

1. Confirm the email and log in.
2. Enable coarse location only if the user intends to use it.
3. Upload 10 photos; optionally enter a coarse place name.
4. Confirm the first Event appears and processing eventually becomes terminal.
5. Kill the web process during analysis once, restart it, and verify the queued
   job resumes without duplicate Evidence, Claims, or gaps.
6. Confirm one gap and search using that exact confirmed phrase.
7. Mark the search result helpful, repeat the query, and verify the learned
   reason appears.
8. Export account data, delete one Memory, then delete the account.

Record first-Event and terminal-analysis timing. The target is first Event in
20 seconds and complete reconstruction in 35 seconds under the chosen provider.

The repeatable browser smoke command performs the same core path and prints the
timings as JSON. It deletes the created Memory in `finally`, but still use a
dedicated account and non-sensitive approved photos:

```bash
LIVE_BASE_URL=https://YOUR_ORIGIN \
LIVE_HERO_EMAIL=hero-test@example.com \
LIVE_HERO_PASSWORD='test-password' \
LIVE_PHOTO_DIR=/absolute/path/to/approved-photos \
LIVE_COARSE_PLACE=神山 \
pnpm test:live:hero
```

To verify checkpoint recovery, stop the deployment process after the job has
advanced to `claims` or `gap`, wait for the five-minute lease to expire, invoke
the worker, and confirm the job resumes at that recorded stage. The resumed run
must not add another Vision `ai_runs` record for a `claims`/`gap` checkpoint.

## 7. Incident triage

- `health.database=false`: verify Supabase URL/secret and migration status.
- `health.aiConfiguration=false`: verify provider URL, key, and all cheap model IDs.
- jobs remain `processing`: inspect lease expiry, then invoke the authenticated
  `/api/analysis/process` resume route or the cron worker.
- repeated AI failure: inspect `ai_runs` and job `last_error_code`; user photos
  remain saved even when reconstruction fails.
- account deletion failure: retry before telling the user deletion completed;
  Storage removal intentionally happens before Auth deletion.
