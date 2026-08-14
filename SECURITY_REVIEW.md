# Re:Memory Security Review

Reviewed: 2026-08-14

## Executive summary

Re:Memory handles personal photos, metadata, inferred memories, and user-confirmed corrections. The current MVP already has a strong security foundation for a hackathon project: per-user isolation with Supabase RLS, private object storage, server-only secrets, strict upload validation, AI prompt-injection boundaries, schema-validated AI output, same-origin checks, rate limits, AI cost guards, and privacy-aware handling of location data.

The main remaining risk is not a known critical vulnerability in the reviewed code. It is incomplete production validation: the security controls still need to be exercised against the real Supabase/Auth/Storage/AI deployment, including cross-user isolation and deployment-origin configuration.

Overall assessment:

- Security architecture: 9/10
- Current implementation: 8.5/10
- Production confidence before live validation: 7.5-8/10

This score is intentionally not a claim that the system is resistant to nation-state or cyber-terror-level attacks. The design is appropriate for a security-conscious MVP and provides defense in depth against common web, AI, privacy, and abuse threats.

## Security model

The effective defense chain is:

`Authentication -> Same-Origin validation -> Input validation -> Authorization/RLS -> Private Storage -> Server-only privileged writes -> AI trust boundary -> Structured-output validation -> Rate/Cost limits -> Auditable provenance`

The guiding principle is that AI is never treated as an authorization system or source of truth.

## What is already strong

### 1. Per-user data isolation

All private domain tables use Row Level Security. Ownership is represented explicitly with `user_id`, and authenticated reads are scoped to `auth.uid()`.

Important provenance tables such as Claims, Evidence relationships, and Corrections are not writable directly from the browser. Privileges are revoked and trusted mutation paths use server-side transactions/RPCs.

The repository includes pgTAP coverage that creates two separate users and verifies that one user cannot read another user's Memory or Evidence. It also verifies that the browser role cannot fabricate Evidence.

### 2. Server-only privileged access

The Supabase secret/service-role credential is loaded only in server-only code. Browser code uses the publishable key, while privileged writes use a separate admin client.

This is the correct architecture, but it creates an important invariant: every admin-client operation must derive `userId` from a freshly authenticated session and must include an explicit ownership predicate because service-role access bypasses RLS.

### 3. Authentication and request integrity

Authenticated routes call Supabase `auth.getUser()` rather than trusting a user id supplied by request input.

State-changing routes use same-origin validation based on `Origin`/`Referer` and `Sec-Fetch-Site`. Session cookies are configured `httpOnly`, `SameSite=Lax`, and `Secure` in production.

Signup and sign-in inputs are validated with Zod, and authentication errors do not disclose whether a specific account exists beyond normal credential failure behavior.

### 4. Private media storage

The `rememory-private` Storage bucket is non-public. Browser access is read-only and constrained to object paths owned by the authenticated user.

Object keys follow an ownership-based pattern:

`{userId}/assets/{assetId}/original`

`{userId}/assets/{assetId}/vision.webp`

UI image access uses short-lived signed URLs rather than making the bucket public.

### 5. Upload hardening

Uploads are not trusted based only on file extension or browser MIME type.

The ingestion path checks:

- per-file byte limits
- magic-byte/file-signature detection
- declared MIME vs actual MIME consistency
- encoded dimensions
- maximum pixel count
- successful image decode through `sharp`
- single-page image constraints
- SHA-256 deduplication per user

The AI derivative is resized and re-encoded as WebP, which strips the original image container metadata from the image sent into the Vision pipeline.

### 6. Location privacy

Exact latitude/longitude are intentionally excluded from the standard database model. The schema contains `coarse_place`, while security tests explicitly reject claim payloads containing exact coordinates.

Important wording for product/security documentation:

> Re:Memory does not persist or send exact GPS coordinates through its normal DB/AI/analytics pipeline. Original user images remain in private storage and may themselves contain original EXIF metadata.

Do not make the stronger claim that exact GPS can never exist anywhere in the system while originals are retained.

### 7. AI prompt-injection boundary

AI prompts explicitly classify media/user content as untrusted data. The model is told not to obey instructions contained in user data or visible image text and is not allowed to decide authorization, ownership, deletion, or database state transitions.

Input is serialized into a bounded `UNTRUSTED_DATA_START` / `UNTRUSTED_DATA_END` boundary, and marker strings are escaped before inclusion.

### 8. AI output is not trusted directly

LLM output is required to conform to structured Zod schemas.

Additional post-validation checks prevent the model from inventing references that were not supplied. Examples include:

- unknown Memory IDs
- unknown Claim IDs
- invented confirmed aliases
- unsupported clarification questions
- unsupported Evidence references

Grounded answer generation is constrained to eligible, supplied claims rather than allowing arbitrary generated facts to become Memory truth.

### 9. Provenance and truth-state protection

AI claims and user-confirmed claims are stored as separate provenance paths. AI claims cannot simply be upgraded in place to user-confirmed truth.

User confirmation creates append-only correction/user-origin provenance. Active deterministic/AI claims require supporting Evidence. This substantially reduces the risk that hallucinated AI output silently becomes trusted application state.

### 10. AI abuse and cost controls

AI requests use a shared per-user rate-limit store and a daily/request cost-reservation system. Failures are fail-closed rather than silently bypassing the limiter.

Provider calls have:

- HTTPS-only remote endpoints
- timeouts
- bounded response size
- bounded retry count
- structured-output validation
- request-cost reservation before execution

This protects both availability and sponsor/API budget.

### 11. Security headers

The Next.js configuration currently sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- Content Security Policy
- removal of `X-Powered-By`

This is a solid baseline for the MVP.

### 12. Safe error handling

Public error responses do not expose raw provider errors, database messages, secrets, or private data. The generic server log records a request id and error class/name rather than serializing sensitive exception contents into the client response.

### 13. Deletion design

Memory deletion is implemented as a stateful server-side transaction flow rather than a direct browser table delete. Storage objects are deleted before database finalization, and retries are designed to be idempotent.

This is important because deleting the UI row without deleting original images would be a significant privacy failure.

## Risks and actions before submission

### P0 - Validate cross-user isolation on the real deployment

The highest-priority security task is to test the controls against the real Supabase project rather than only static/unit/integration mocks.

Required test:

1. Create User A and User B.
2. Upload a Memory as User A.
3. Capture the Memory id and relevant API paths.
4. Authenticate as User B.
5. Attempt to read, mutate, confirm, search for, access media from, and delete User A's Memory.
6. Confirm the result is denied or indistinguishable from a nonexistent resource.

Also test that User B cannot use a guessed signed-storage path to retrieve User A's original or derivative.

### P0 - Configure the production origin correctly

Production deployment must set a canonical `APP_ORIGIN` and align Supabase Auth configuration with the actual deployed URL.

Verify:

- `APP_ORIGIN=https://<production-host>`
- Supabase Site URL uses the production host
- Auth redirect allowlist contains the production `/auth/confirm` route
- preview deployments do not accidentally become accepted canonical origins for production cookies/mutations unless intentionally supported

The repository's local Supabase config still points at localhost, which is correct for local development but is not a production configuration.

### P0 - Audit every service-role/admin-client call

Because the admin client bypasses RLS, perform a repository-wide audit of every `createSupabaseAdminClient()` call.

For each call verify:

- authenticated user is resolved first
- request-controlled `userId` is never trusted
- every read/update/delete is constrained by `.eq("user_id", user.id)` or an equivalent ownership-safe RPC
- returned object ids are checked for ownership before use
- RPCs receiving `p_user_id` are called only from trusted server code

This is the most important code-level invariant in the backend.

### P1 - Add upload abuse/storage quota protection

AI calls have strong rate and cost controls, but media uploads can still consume CPU, bandwidth, and private storage before or independently of model cost.

Recommended additions:

- per-user upload request rate limit
- per-user daily upload byte limit
- per-user total storage quota
- optional global concurrency limit for expensive `sharp` decoding

The existing per-request file-count, file-size, and pixel limits should remain.

### P1 - Add authentication abuse protection

For a public release, add or verify provider-level controls for:

- repeated failed sign-in attempts
- signup abuse
- bot protection/CAPTCHA when appropriate
- password reset throttling
- optional MFA for users and mandatory MFA for administrators

Do not build a custom password/authentication system; keep this at the Auth/provider/WAF layer.

### P1 - Harden deployment and administrator security

Application-layer security is not enough if GitHub, Vercel, Supabase, or provider administrator accounts are compromised.

Recommended operational controls:

- MFA for GitHub, Supabase, Vercel/hosting, and AI provider accounts
- least-privilege collaborator access
- branch protection on `main`
- required PR review for production changes
- required CI checks
- restricted secret-management permissions
- immediate credential rotation procedure

Current repository inspection shows `main` is not branch-protected. This should be addressed before treating the project as production-grade.

### P1 - Supply-chain controls

Recommended:

- keep the lockfile committed and use frozen-lockfile installs in CI
- dependency/security update automation
- review dependency changes separately from feature changes
- pin or deliberately version GitHub Actions
- run dependency vulnerability scanning in CI when practical

### P2 - CSP hardening

The current CSP is a useful baseline, but production `script-src` still allows `'unsafe-inline'`.

Longer term, prefer a nonce/hash-based Next.js CSP where feasible and consider adding HSTS after confirming the deployment is HTTPS-only.

This is not the highest-priority hackathon fix compared with live authorization testing and secret/origin configuration.

### P2 - Incident response and recovery

A mature production plan should assume compromise is possible and define recovery steps:

1. detect abnormal activity
2. revoke/rotate affected API and service credentials
3. restrict or disable affected endpoints
4. determine impacted users/data
5. restore from trusted backups if required
6. deploy a verified fix
7. re-enable services gradually
8. record the incident and preventive changes

Backups must be protected with the same sensitivity as production data.

## Cyberattack / cyber-terror threat positioning

Do not claim that Re:Memory is "cyber-terror proof" or resistant to state-level attackers. That would exceed what the current architecture and validation demonstrate.

A defensible statement is:

> Re:Memory uses defense in depth against common web attacks, account/data isolation failures, malicious uploads, AI prompt injection, data leakage, and API abuse. Large-scale DDoS, administrator-account compromise, cloud-provider compromise, and advanced persistent threats require additional infrastructure and operational controls outside the application itself.

For large-scale attacks, protection must also exist at CDN/WAF/cloud/account-management layers. Application rate limits alone cannot absorb volumetric DDoS traffic.

## Security strengths worth showing to judges

The strongest differentiator is that security and AI trust are part of the data architecture rather than a disclaimer added at the end.

Suggested presentation wording:

> Re:Memory handles personal photos, so AI is not allowed to become the source of truth. Data is isolated per user with RLS and private storage. Exact location is minimized, Vision receives a metadata-free derivative, secrets remain server-side, and every AI result must pass a structured schema and Evidence-reference validation before it can influence a Memory. User confirmation is stored as separate provenance rather than rewriting an AI guess into fact.

This communicates security, privacy, AI reliability, and product philosophy in one explanation.

## Submission security checklist

- [ ] Real Supabase migration applied successfully
- [ ] RLS cross-user test performed against real deployment
- [ ] Private Storage cross-user access test performed
- [ ] `APP_ORIGIN` set to production URL
- [ ] Supabase Auth Site URL / redirects configured
- [ ] Supabase secret/service-role key exists only in server secret storage
- [ ] OrcaRouter/API key exists only in server secret storage
- [ ] No secret appears in Git history, screenshots, demo video, or client bundle
- [ ] All admin-client calls audited for user ownership predicates
- [ ] Upload MIME/magic-byte/decode/size controls verified with malformed samples
- [ ] Prompt-injection/structured-output tests pass
- [ ] AI rate/cost controls enabled in deployed environment
- [ ] Delete flow verified to remove both original and derivative Storage objects
- [ ] Production security headers verified in browser/network inspector
- [ ] `main` branch protection / PR review policy considered or enabled
- [ ] Incident/credential rotation owner identified

## Final assessment

No obvious critical vulnerability was found in the reviewed MVP security architecture. The strongest implemented areas are authorization boundaries, private media storage, AI trust separation, provenance validation, upload validation, and API/cost abuse controls.

The largest remaining security gap is deployment assurance: the project now needs live-environment verification proving that the designed boundaries actually hold under real Auth, RLS, Storage, and service-role behavior.
