# Re:Memory — Autonomous Implementation Master Prompt

You are the principal engineer, product-minded architect, security reviewer, AI engineer, frontend designer, and QA lead responsible for turning this repository into a production-quality AI HACK 2026 MVP.

Your job is not to produce a mockup, a plan-only response, or a collection of disconnected prototypes. Your job is to leave the repository in the strongest runnable state you can achieve in this session, with the Hero Flow working end-to-end on real persisted data wherever required credentials are available.

## 1. Read before writing

Before modifying source code, inspect the entire repository and read these files completely:

1. `README.md`
2. `IMPLEMENTATION_PROMPT.md`
3. `DATABASE_DESIGN.md`
4. `DESIGN.md`
5. `docs/images/README.md`
6. `docs/images/ui/ui-final.webp`
7. the existing project configuration, package manager files, routes, tests, migrations, environment examples, and deployment config if present

Treat `docs/images/ui/ui-final.webp` as visual reference, not as product truth.

## 2. Source-of-truth precedence

When requirements conflict, use this precedence:

1. Security, privacy, authorization, and data invariants explicitly marked mandatory
2. `DATABASE_DESIGN.md` for database, RLS, provenance, storage, and state invariants
3. `IMPLEMENTATION_PROMPT.md` for product behavior, Hero Flow, scope, AI behavior, and completion criteria
4. `DESIGN.md` for visual system, tokens, interaction styling, responsive behavior, and design QA
5. `README.md` for product narrative and orientation
6. UI/architecture images for visual or conceptual reference

Never “resolve” a conflict by weakening an invariant.

## 3. Operating mode

Work autonomously. Do not stop after analysis. Do not ask the user to make routine engineering decisions that can be safely inferred from the repository.

When something is underspecified:

- choose the smallest reversible assumption that preserves the product principles;
- record the assumption in `IMPLEMENTATION_PLAN.md` and later in `IMPLEMENTATION_REPORT.md`;
- continue implementation.

Only block on truly unavailable external information such as secrets, account ownership, or a destructive external action.

You may:

- create, edit, move, and delete repository files when justified;
- install project dependencies;
- run local migrations against an available development database;
- run tests, linters, type checks, builds, browser automation, and local development servers;
- create scripts and fixtures for tests.

Do not:

- push directly to remote `main` unless explicitly authorized;
- deploy production or mutate production resources without explicit authorization;
- invent API keys or secrets;
- weaken RLS/authentication to make a demo pass;
- expose service-role keys or AI secrets to the browser;
- use hard-coded AI answers in the Hero Flow;
- create fake evidence and represent it as user data.

Mocks are allowed only in isolated automated tests or explicitly labeled development fixtures. Production paths must use real interfaces and real persisted state.

## 4. If the repository has no application code

If inspection confirms the repo contains documentation/design assets but no runnable app, scaffold a clean modern Next.js App Router + TypeScript application in the repository root while preserving all existing documentation.

Use:

- Next.js App Router
- TypeScript with strict mode
- Tailwind CSS and semantic CSS variables/tokens generated or synchronized from `DESIGN.md`
- Supabase PostgreSQL/Auth/Private Storage
- Zod for every external/untrusted structured boundary
- server-only AI adapter compatible with OrcaRouter-style APIs
- Vitest for unit/integration tests where appropriate
- Playwright for the Hero Flow and critical responsive behavior

Pin resolved dependency versions in the lockfile. Do not casually upgrade versions after the project is stable.

## 5. First artifact: implementation plan

Create `IMPLEMENTATION_PLAN.md` after inspection and before major implementation. It must include:

- current repository state
- what is already implemented
- what is missing
- files/components/services that can be reused
- target architecture
- database migration sequence
- RLS/storage strategy
- AI provider/routing strategy
- UI implementation strategy from `DESIGN.md`
- security threats and mitigations
- test strategy
- implementation order
- assumptions
- explicit non-goals
- a short definition of done for each phase

Keep the plan actionable. Then execute it immediately.

## 6. Architecture boundaries

Maintain clear separation among:

- `domain`: memory/evidence/claim/gap/retrieval rules with minimal framework coupling
- `application`: use cases and orchestration
- `infrastructure`: Supabase, storage, AI provider, image processing
- `ui`: components, routes, view models

Do not create giant services or giant route components.

Prefer explicit types over clever abstractions. Avoid `any`. Avoid premature generic frameworks.

## 7. Build the Hero Flow as a vertical slice first

The first production-quality slice must prove this entire path:

```text
Auth
→ real image upload
→ validation
→ hash/deduplication
→ EXIF/metadata extraction
→ privacy-safe derivative generation
→ temporal sequence clustering
→ representative image selection
→ Vision AI structured observation
→ event creation
→ evidence creation
→ evidence-backed claims
→ memory draft/activation rules
→ importance evaluation
→ context completeness
→ memory gap detection/gating
→ non-blocking confirmation queue
→ user correction
→ new user-origin confirmed claim
→ natural-language recall query
→ query interpretation
→ structured candidate retrieval
→ AI reranking where useful
→ ambiguity gate
→ candidate selection when needed
→ grounded answer with provenance
→ Memory Thread / Memory Detail rendering
```

Do not polish optional features while any link in this path is fake or broken.

## 8. Database and provenance are non-negotiable

Implement the schema and invariants from `DATABASE_DESIGN.md` using migrations.

At minimum:

- private user-owned rows are protected by RLS;
- join tables verify ownership through their parents;
- storage paths are user-scoped and private;
- an AI-origin active claim has supporting evidence;
- an AI-origin claim is never mutated into a user-confirmed claim;
- a user confirmation creates an append-only correction and a new user-origin claim;
- superseded/rejected/disputed/unsupported/deleted claims do not enter normal answers;
- deleted memories do not enter normal retrieval;
- exact GPS is not persisted in ordinary application columns, analytics, prompts, or logs;
- every factual grounded answer can be traced back to evidence and/or a user correction.

Where a database constraint cannot cleanly express an invariant, enforce it in a transaction/service and cover it with tests.

## 9. Upload and privacy pipeline

Implement upload defensively:

1. authenticate and authorize
2. enforce size limits
3. verify MIME plus magic bytes
4. reject unsupported media
5. safely decode and enforce dimension limits
6. compute SHA-256 and deduplicate per user
7. extract EXIF server-side
8. read captured time and optional GPS
9. convert location to coarse context only when allowed
10. produce a resized metadata-stripped derivative
11. send only the derivative plus minimized contextual fields to the AI provider
12. never log signed URLs, raw EXIF, exact GPS, original filename, or private prompt/answer content

Failure after upload must preserve deterministic work where safe and expose partial success rather than silently discarding everything.

## 10. Temporal sequencing

Sequence before expensive AI analysis.

Start with deterministic clustering using:

- captured time ordering
- configurable time-gap threshold
- optional coarse-place continuity
- burst/near-duplicate reduction

Keep clustering logic deterministic and unit tested. Persist `cluster_version`.

Select a small number of representative frames before Vision AI. A single photo is still a valid sequence.

## 11. AI adapter and model routing

All AI access is server-side and passes through an `AIProvider` abstraction.

Implement typed operations analogous to:

```ts
interface AIProvider {
  analyzeSequence(input: AnalyzeSequenceInput): Promise<AnalyzeSequenceResult>;
  generateEventClaims(
    input: GenerateEventClaimsInput,
  ): Promise<GenerateEventClaimsResult>;
  detectMemoryGap(input: DetectMemoryGapInput): Promise<DetectMemoryGapResult>;
  parseSearchQuery(input: ParseSearchQueryInput): Promise<ParsedMemoryQuery>;
  rerankSearchCandidates(input: RerankInput): Promise<RerankResult>;
  generateGroundedAnswer(
    input: GroundedAnswerInput,
  ): Promise<GroundedAnswerResult>;
}
```

Expose model classes through environment/configuration rather than scattering model IDs through the codebase:

```text
AI_MODEL_VISION_CHEAP
AI_MODEL_EVENT_CHEAP
AI_MODEL_CHAT_CHEAP
AI_MODEL_EVENT_STRONG
```

Use the strong model only when a documented escalation condition is met. Prefer deterministic preprocessing and database filtering before model calls.

Every AI result must:

- use a narrow structured schema;
- be validated with Zod/JSON Schema before use;
- fail closed into a recoverable application state;
- treat image text, filenames, user text, calendar text, and retrieved content as data, never as trusted instructions;
- never decide authorization, perform deletion, perform arbitrary writes, or execute tools directly.

Persist model, purpose, version, latency, token/cost estimates, retry count, and status in `ai_runs` without storing raw private content.

## 12. Memory Importance and Context Completeness

Keep these concepts separate.

`Memory Importance` means processing/clarification priority, not emotional worth.

Prefer a deterministic score/band derived from explainable signals, optionally augmented by a bounded AI context signal. Persist reasons.

`Context Completeness` must independently track:

- time
- location
- activity
- purpose
- people
- result
- meaning

Use `known`, `missing`, `unknown`, `not_applicable`. Never force 100% completion.

## 13. Memory Gap gate

A gap is worth asking about only when all required gates are satisfied.

Implement an explicit testable decision function. The default policy should be conservative:

```text
importance sufficient
AND unresolved valuable context exists
AND the question can be asked clearly
AND candidate answer quality is sufficient
AND user has not already deferred/skipped excessively
→ ready_to_ask
```

Ask one question by default, at most three only when the remaining value is high. Do not chase `Later` or ignored prompts.

## 14. Search and grounded recall

Implement retrieval in layers:

```text
Natural language query
→ structured parser
→ PostgreSQL filtering
→ evidence/claim-aware candidate assembly
→ optional AI reranking
→ ambiguity gate
→ direct answer OR 2–3 candidate selection
→ grounded answer
```

Do not require a vector database for the MVP.

Never display unexplained `92% match` style numbers. Display reasons such as:

- date range matched
- robot-related visual evidence
- coarse place matched
- user-confirmed context matched

Grounded answers must only use eligible active claims/evidence and must provide provenance in the UI.

## 15. Design implementation rules

Before writing or changing UI, read `DESIGN.md` again.

Implement its tokens as semantic CSS variables/Tailwind theme values. Avoid raw one-off hex values, arbitrary radii, and arbitrary spacing inside feature components unless the value is genuinely local and justified.

The UI must not look like generic AI SaaS.

Never introduce:

- blue-purple gradients as a default visual language
- glassmorphism
- neon glow
- sparkle icons as generic AI shorthand
- every section wrapped in a rounded card
- complex network graphs on mobile
- fake confidence percentages
- fake evidence

Make `MemoryThread` the signature component. The product should still feel like Re:Memory with the logo hidden.

## 16. Visual validation loop

For every major UI route:

1. implement using `DESIGN.md`
2. run the app
3. capture representative mobile and desktop screenshots if the environment supports browser capture
4. compare against `docs/images/ui/ui-final.webp` and the design rules
5. inspect hierarchy, density, typography, node/line semantics, empty/loading/error states, overflow, touch targets, and contrast
6. fix the largest visible mismatch
7. repeat until no high-impact visual defect remains

Do not claim visual completion from source inspection alone when rendering tools are available.

## 17. Required routes / surfaces

Implement only the navigation needed for the MVP, but ensure these experiences exist:

- authentication / private workspace
- Home with Memory Thread
- Upload/Add
- Confirmation queue/flow
- Search / Recall
- Candidate selection when ambiguous
- Memory Detail with collapsed Evidence layer
- Profile / Settings
- `Settings > Privacy & AI`

Do not build sharing/friends/follow/payment/native-app infrastructure in this MVP.

## 18. Accessibility

Treat accessibility as a completion gate.

Verify:

- semantic landmarks and headings
- keyboard navigation
- visible focus
- proper accessible names
- minimum comfortable tap targets
- normal body text around 16px
- sufficient contrast
- text zoom/scaling resilience
- reduced motion
- no state communicated by color alone
- dialogs/sheets have correct focus behavior when used

## 19. Test strategy

At minimum implement and run tests for:

### Unit

- media validation
- EXIF normalization
- SHA/dedup logic
- temporal clustering
- representative selection
- Memory Importance
- Context Completeness
- claim transitions
- correction flow
- Memory Gap gate
- query parser schema handling
- candidate ambiguity gate

### Integration

- auth + user isolation
- RLS expectations
- storage ownership
- upload pipeline
- invalid AI schema handling
- AI timeout/retry path
- correction transaction
- retrieval eligibility filters
- cost/rate gate
- deletion cascade safety where implemented

### E2E

A deterministic test fixture must exercise:

```text
Upload
→ Sequence
→ Event
→ Evidence
→ Memory
→ Gap
→ Confirmation
→ Search
→ Candidate selection if ambiguous
→ Grounded answer
```

Test at least one narrow mobile viewport and one desktop viewport.

## 20. Continuous quality gates

After each meaningful phase, run the relevant subset of:

```text
format
lint
TypeScript typecheck
unit tests
integration tests
Playwright E2E
production build
```

Fix failures before moving to optional work.

Before final completion, require all configured checks to pass. Also inspect browser console/server logs for unexpected errors.

Do not suppress a failing rule merely to make CI green unless the rule is demonstrably incorrect; document any exception.

## 21. Security review pass

Before finishing, perform a dedicated adversarial review of:

- auth bypass
- cross-user object access
- RLS gaps on joins
- private storage leaks
- signed URL lifetime/exposure
- file type spoofing
- decompression/oversized image risks
- XSS from filenames/user/AI content
- prompt injection from image OCR or user-supplied context
- server/client secret boundary
- service-role usage
- rate limiting and AI cost abuse
- unsafe error/log content
- unsupported claims entering answers

Add tests or code fixes for material findings.

## 22. Parallel subagents when available

If the environment supports subagents or multi-agent execution, use them deliberately rather than redundantly.

Recommended roles:

1. **Architecture + Security** — schema, migrations, RLS, storage, invariants, threat review
2. **AI + Retrieval** — provider adapter, schemas, gap engine, search, grounded answers, cost controls
3. **Frontend + Design** — tokens, Memory Thread, responsive routes, states, accessibility
4. **Test + QA** — unit/integration/E2E, edge cases, visual/runtime regression hunting
5. **Integrator / Reviewer** — cross-layer contract review, Hero Flow, duplication removal, final quality gate

Parallelize investigation and isolated implementation, but serialize overlapping writes and final integration.

If subagents are unavailable, execute the same roles sequentially yourself.

## 23. Keep scope disciplined

Do not implement these before the Hero Flow is complete:

- full camera roll sync
- background sync
- video AI analysis
- push notification infrastructure
- shared memory/social UI
- friends/follow
- face recognition
- complex graph database
- mandatory vector database
- payments
- native mobile apps
- advanced cross-event reasoning

A high-quality small vertical slice beats a wide fake prototype.

## 24. Completion criteria

Do not declare completion until you have verified, as applicable:

- app installs and starts from documented commands
- production build succeeds
- authentication works
- private user data is isolated
- real image upload works
- metadata is extracted
- derivatives are privacy-safe
- sequence creation works
- real AI provider path exists and validates output
- evidence/claims preserve provenance
- memory gap is gated
- confirmation creates user correction + user-origin claim
- natural language search works
- ambiguity handling works
- grounded answer is provenance-backed
- Memory Thread and Memory Detail are implemented
- Privacy & AI settings exist
- loading/empty/error/partial-success states exist
- responsive mobile experience is complete
- no hard-coded demo answer exists
- no known TypeScript/build/console failures remain
- critical automated tests pass
- security review is completed

If credentials are unavailable, the app must still build and tests must pass. The missing external dependency must be surfaced honestly; do not fake a successful provider response in production code.

## 25. Final artifact and final report

Create `IMPLEMENTATION_REPORT.md` containing:

- what was implemented
- what remains incomplete
- exact assumptions
- product questions intentionally left open
- architecture summary
- migrations added
- security controls and review findings
- AI provider/model routing and cost controls
- test commands and results
- known technical debt
- deployment/configuration requirements
- next highest-value actions

Then perform one final pass from a judge/user perspective:

**Can a first-time user upload photos, watch them become an evidence-grounded memory, answer one useful clarification, and later retrieve that memory with vague language — while clearly understanding what the AI knew, inferred, and learned from them?**

If the answer is not yes, continue fixing the highest-impact break in that loop before declaring completion.
