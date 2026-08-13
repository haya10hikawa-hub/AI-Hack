# Re:Memory Implementation Plan

## Current repository state

The outer repository at `/Users/sotanakano/Documents/ChatGPT/AI-Hack` is the
canonical implementation root. At inspection time it contained six product,
database, design, and agent documents plus seven visual references, but no
runnable application. A byte-identical nested clone exists at `AI-Hack/`; it is
explicitly ignored and will not be modified or staged.

## Implemented before this plan

- Product narrative, Hero Flow, security/privacy invariants, and MVP scope.
- Relational Supabase schema design and target RLS/storage policies.
- Memory Editorial design tokens and final UI/architecture references.

No application code, migrations, tests, CI, runtime configuration, or deploy
configuration existed.

## Missing at inspection

- Next.js application, authentication, private workspace, and routes.
- Upload validation, metadata extraction, derivative generation, clustering.
- Real server-only AI adapter, evidence/claim persistence, memory engine.
- Confirmation/correction and grounded retrieval.
- Supabase migrations/RLS/private storage.
- Unit, integration, E2E, runtime, responsive, security, and visual validation.

## Target architecture

- `app/`: Next.js App Router pages and server-only Route Handlers.
- `src/domain/`: deterministic rules with no framework coupling.
- `src/server/`: Supabase, AI provider, upload, application orchestration.
- `src/components/`: accessible Memory Editorial UI.
- `supabase/migrations/`: schema, transaction helpers, RLS, storage policies.
- `tests/`: unit, integration-contract, and browser tests.

Production paths use Supabase and a configured OrcaRouter-compatible endpoint.
There is no production fake backend or hard-coded AI answer. Automated tests may
use isolated fakes at external boundaries, as explicitly permitted by the spec.

## Database and migration strategy

One ordered baseline migration creates profiles/preferences, assets/sequences,
events/evidence/memories, claims/corrections, gaps/relations/context, AI runs,
indexes, invariant functions, RLS, and a private bucket. Join-table policies
authorize through owner-scoped parents. Claim/correction state changes execute
through security-invoker transactions where possible.

## API strategy

All private routes authenticate using a Supabase cookie session and re-check
row ownership through RLS. Route inputs and AI outputs are schema-validated.
Upload endpoints enforce count, bytes, magic bytes, decoded dimensions, SHA-256
deduplication, metadata minimization, and idempotent conflict handling.

## AI pipeline

A server-only typed provider exposes sequence analysis, event claims, gap
detection, query parsing, reranking, and grounded answer generation. Model IDs
come only from environment configuration. Calls have timeouts, bounded retry,
rate/cost gates, structured output validation, and metadata-only audit rows.
Unconfigured AI fails closed while deterministic upload work remains preserved.

## UI strategy

Implement semantic tokens from `DESIGN.md`, smartphone-first. Home is a Memory
Thread, not a dashboard. Filled nodes/solid lines show evidence or confirmation;
open nodes/dotted lines show inference. Memory identity outranks AI. All primary
surfaces provide loading, empty, error, processing, partial-success, and unknown
states without fabricated user content.

## Security threats and mitigations

- IDOR/cross-user access: authenticated clients plus RLS on every private table.
- Storage disclosure: private bucket, owner-prefixed paths, short signed URLs.
- Spoofed/decompression uploads: MIME+magic+decode+pixel+byte validation.
- Prompt injection: untrusted image/user text is delimited data, never system text.
- Secret exposure: AI credentials remain server-only; no service-role browser use.
- Cost abuse: per-user rate/cost gates and representative-frame selection.
- Unsupported answers: retrieval eligibility filters and provenance assertions.
- XSS/CSRF: React escaping, same-origin cookie routes, Origin checks on writes,
  CSP and security headers.

## Test strategy

- Unit: validation, hashing, EXIF normalization, clustering, representative
  selection, importance/completeness/gaps, claim transitions, parsing/ambiguity.
- Integration: AI invalid output/timeout/cost, correction idempotency, retrieval
  eligibility, SQL/RLS policy coverage, upload orchestration boundary.
- E2E: honest unauthenticated/empty/error UI plus an isolated route-backed Hero
  fixture covering clarification, confirmation, re-query, and provenance at both
  390px and desktop widths.
- Final: lint, strict typecheck, tests, Playwright, production build, server/browser
  console inspection, responsive screenshots, accessibility and adversarial pass.

## Implementation order and definitions of done

1. **Foundation** — pinned install, strict checks and production build pass.
2. **Data/security** — migration includes all ownership and provenance invariants.
3. **Domain/AI** — deterministic rules and schemas pass adversarial unit tests.
4. **Hero vertical slice** — authenticated upload to persisted Memory, correction,
   retrieval and grounded provenance are wired without production mocks.
5. **Product UI** — all required surfaces render across target widths and states.
6. **Quality gate** — configured automated checks pass; external credential gaps
   are reported honestly and never replaced by a fake production success.

## Assumptions

- The outer repository is canonical; the nested clean duplicate is user-owned and
  preserved untouched.
- Next.js App Router, pnpm, Supabase and an OpenAI-compatible OrcaRouter endpoint
  follow the existing specifications.
- Coarse geocoding is not guessed without an approved provider. Exact GPS may be
  read transiently for future coarse conversion but is neither persisted nor sent.
- Confirmation remains a Home entry point rather than a permanent navigation tab.
- Calendar and people recognition remain disconnected, truthfully labeled future
  sources; Phase 2 sharing is excluded.

## Explicit non-goals

Automatic camera-roll sync, video analysis, push infrastructure, social/sharing,
face recognition, graph/vector databases, payments, and native applications.
