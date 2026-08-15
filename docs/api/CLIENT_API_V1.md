# Re:Memory Client API v1

The contract a native client may build on. It describes the backend that exists;
it does not ask the backend to change. Memory Core, truth semantics, and search
ranking are out of scope here and stay as they are.

Machine-readable form: [`src/contracts/client-api-v1.ts`](../../src/contracts/client-api-v1.ts).
When this document and that module disagree with a route, the route is right.

---

## 1. Base URL

| Environment | Base URL                      |
| ----------- | ----------------------------- |
| Local       | `http://localhost:3000`       |
| Deployed    | the app origin (`APP_ORIGIN`) |

All paths below are relative to the base URL. Every request and response is
JSON, `Content-Type: application/json`, UTF-8. Responses carry
`cache-control: private, no-store`; a client must not write them to a shared or
on-disk HTTP cache.

---

## 2. Success envelope

Every 2xx body is a single-key object:

```json
{ "data": { "...": "payload" } }
```

There is no pagination envelope, no `meta`, and no top-level status field. Unwrap
`data` and decode the payload.

---

## 3. Error envelope

Every non-2xx body is:

```json
{ "error": { "code": "MEMORY_NOT_FOUND", "message": "…", "requestId": "…" } }
```

- `code` — stable machine identifier. Branch on this, never on `message`.
- `message` — Japanese end-user copy owned by the server. A native client may
  show it, but must not lay out a screen around its length or wording.
- `requestId` — present when the caller sent `X-Request-Id` or the server
  generated one. Log it; it is the only safe correlation handle.

| Status | Code                     | Meaning                                             |
| ------ | ------------------------ | --------------------------------------------------- |
| 400    | `INVALID_INPUT`          | Request body failed validation                      |
| 400    | `UPLOAD_SESSION_INVALID` | Manifest expired or does not match the caller       |
| 401    | `AUTH_TOKEN_INVALID`     | Bearer token missing, malformed, expired, revoked   |
| 401    | `AUTH_REQUIRED`          | Browser session could not be established            |
| 403    | `ORIGIN_REJECTED`        | Cookie mutation from a foreign origin               |
| 404    | `MEMORY_NOT_FOUND`       | No such Memory for this owner                       |
| 404    | `GAP_NOT_FOUND`          | No such confirmation for this owner                 |
| 409    | `GAP_NOT_ANSWERABLE`     | Confirmation already resolved                       |
| 413    | `FILE_TOO_LARGE`         | A file exceeds the per-file limit                   |
| 400    | `TOO_MANY_FILES`         | Batch exceeds the per-request limit                 |
| 429    | `AI_RATE_LIMITED`        | AI processing is saturated                          |
| 429    | `AI_COST_LIMIT`          | Daily AI budget reached; stored Memories still work |
| 503    | `AI_UNAVAILABLE`         | AI step could not complete safely                   |
| 503    | `SERVICE_NOT_CONFIGURED` | Storage/AI not configured in this environment       |
| 500    | `INTERNAL_ERROR`         | Unhandled failure                                   |

An unknown code must degrade to generic handling of its HTTP status, never to a
crash.

---

## 4. Auth modes

The server resolves exactly one identity per request
(`resolveRequestAuth` in [`src/server/supabase/auth.ts`](../../src/server/supabase/auth.ts)):

| Mode      | Trigger                     | Client used                     | Who a native client is |
| --------- | --------------------------- | ------------------------------- | ---------------------- |
| `bearer`  | `Authorization` header sent | RLS client bound to the token   | ✅ this one            |
| `cookie`  | no header, valid session    | RLS client bound to the cookie  | web only               |
| `preview` | no header, no session       | admin client, Public Preview id | web only               |

Native rules:

1. Send `Authorization: Bearer <supabase access token>`.
2. The token is verified **server side** against the Supabase auth server on
   every request. The identity comes from the token; a `userId` in a request body
   is never read and, on the strict-schema routes, is rejected as
   `INVALID_INPUT`.
3. **A rejected token never degrades.** Malformed header, wrong scheme, expired,
   or revoked all answer `401 AUTH_TOKEN_INVALID`. There is no fallback to the
   cookie session and no fallback to Public Preview — a native client can never
   silently end up writing into a throwaway preview account.
4. Sending _any_ `Authorization` header selects the bearer path. There is no way
   to mix a token with the browser session.

On `401 AUTH_TOKEN_INVALID`: refresh the Supabase session, retry the request once,
and if it fails again, sign the user out. Do not loop.

---

## 5. Stable endpoints

Frozen for v1. Fields may be **added**; existing field names, types, and
enum members will not change or disappear without a version bump (§14).

| Method | Path                    | Purpose                     |
| ------ | ----------------------- | --------------------------- |
| GET    | `/api/memories`         | Memory list                 |
| GET    | `/api/memories/:id`     | Memory detail               |
| GET    | `/api/gaps`             | Confirmation queue          |
| POST   | `/api/gaps/:id/confirm` | Answer one confirmation     |
| POST   | `/api/upload/prepare`   | Reserve signed upload slots |
| POST   | `/api/upload/complete`  | Commit an uploaded batch    |

Plus the direct signed **Storage** upload between the two upload calls (§11).

---

## 6. Provisional endpoints

| Method | Path          | Status      |
| ------ | ------------- | ----------- |
| POST   | `/api/search` | Provisional |

The request shape and the top-level response envelope are recorded so a client
can call it without crashing. **Nothing inside it is frozen.** Hybrid retrieval,
FTS, vector search, and RRF are expected to change, so a native UI must not
depend on:

- candidate ordering or count
- any score, ranked or structured
- `matchReasons` — presence or wording
- `sources[]` — presence, `label` wording, or `kind`
- the internal shape of a candidate beyond its `memory`

Treat `answer`, `clarification`, and `interpretation` as advisory text. Build the
search screen so that a response carrying only `candidates[].memory` still
renders correctly.

Everything else under `/api/*` (auth, account, analysis, map, privacy settings,
search feedback, memory deletion) is **not** part of this contract. Those routes
keep their existing browser-only behaviour.

---

## 7. Request schemas

### POST /api/gaps/:id/confirm

Each variant is strict — no extra keys.

```jsonc
{ "decision": "confirm" }
{ "decision": "later" }
{ "decision": "correct", "correctionText": "FTCの練習" }   // 1–500 chars, trimmed
```

### POST /api/upload/prepare

```jsonc
{
  "files": [
    { "name": "IMG_0001.HEIC.jpg", "mimeType": "image/jpeg", "bytes": 2411233 },
  ],
}
```

`mimeType` ∈ `image/jpeg` | `image/png` | `image/webp`. 1–20 entries per request,
further limited by the deployment's `UPLOAD_MAX_FILES` (default 12) and
`UPLOAD_MAX_BYTES_PER_FILE` (default 15 MB) — exceeding those answers
`TOO_MANY_FILES` / `FILE_TOO_LARGE`. Convert HEIC to JPEG on device before
calling.

### POST /api/upload/complete

```jsonc
{
  "manifest": "<opaque token from prepare>",
  "timezoneOffsetMinutes": 540, // required, may be null; -840…840
  "timezone": "Asia/Tokyo", // optional
  "coarsePlace": "徳島県神山町", // optional, may be null; ≤80 chars
}
```

### POST /api/search (provisional)

```jsonc
{
  "query": "神山でロボットを作った日",
  "timezone": "Asia/Tokyo", // defaults to Asia/Tokyo
  "currentDate": "2026-08-15", // YYYY-MM-DD
  "cellId": "<memory map cell>", // optional
}
```

---

## 8. Response schemas

### GET /api/memories → `MemoryThreadTransport`

```jsonc
{
  "data": {
    "memories": [
      {
        "id": "uuid",
        "title": "神山でのロボット制作",
        "capturedAt": "2026-05-01T09:00:00Z", // nullable
        "placeLabel": "徳島県神山町", // nullable
        "photoCount": 8,
        "representativeImageUrl": "https://…", // nullable, short-lived (§10)
        "representativeImageAlt": "…",
        "state": "evidence|confirmed|inferred|unknown|disputed",
        "processingState": "ready|uploaded|processing|partial|failed",
        "summary": "…", // nullable
        "relationLabel": "…", // nullable, server wording (§13)
        "relationState": "confirmed|inferred", // nullable
        "hasOpenGap": true,
        "evidenceCount": 12,
      },
    ],
    "pendingConfirmationCount": 1,
    "partial": true,
    "partialMessage": "…", // nullable
  },
}
```

`partial: true` means reconstruction is still running or has failed for at least
one Memory. The list is complete and safe to show; poll for the rest.

### GET /api/memories/:id → `MemoryDetailTransport`

```jsonc
{
  "data": {
    "memory": { "…thread item…", "description": "…", "updatedAt": "…" },
    "representatives": {
      "identity":  { "assetId": "uuid", "imageUrl": "https://…", "alt": "…" },
      "keyMoment": null,
      "complement": null
    },
    "relatedMemories": [
      {
        "memoryId": "uuid",
        "title": "…",
        "capturedAt": "…",                       // nullable
        "relationType": "before|same_place|same_activity",
        "relationState": "confirmed|inferred",
        "representativeImageUrl": "https://…"    // nullable
      }
    ],
    "reconstruction": "…",                       // nullable
    "claims": [
      {
        "id": "uuid",
        "text": "purpose: FTCの練習",             // server-composed (§13)
        "state": "evidence|confirmed|inferred|unknown|disputed",
        "origin": "deterministic|ai|user",
        "evidenceIds": ["uuid"]
      }
    ],
    "evidence": [
      {
        "id": "uuid",
        "label": "captured_at",
        "detail": "…",                           // nullable
        "kind": "photo|metadata|user_correction|related_memory|other",
        "sourceLabel": "metadata",               // nullable
        "imageUrl": "https://…",                 // nullable, short-lived (§10)
        "capturedAt": "…"                        // nullable
      }
    ],
    "partial": false,
    "partialMessage": null
  }
}
```

404 `MEMORY_NOT_FOUND` covers both "does not exist" and "belongs to someone
else". A client must not distinguish them.

### GET /api/gaps → `ConfirmationQueueTransport`

```jsonc
{
  "data": {
    "gaps": [
      {
        "id": "uuid",
        "memoryId": "uuid",
        "memoryTitle": "神山でのロボット制作",
        "question": "これはFTCの練習でしたか？",
        "candidateLabel": "FTCの練習", // nullable
        "evidenceSummary": "…", // nullable
        "state": "open",
      },
    ],
    "partial": false,
    "partialMessage": null,
  },
}
```

At most 20 entries, oldest first. Deferred items reappear once their defer
window elapses.

### POST /api/gaps/:id/confirm → `ConfirmationMutationResponse`

```jsonc
// decision: confirm | correct
{ "data": { "saved": true, "createdClaimId": "uuid|null" } }

// decision: later
{ "data": { "saved": true, "deferred": true, "deferredUntil": "…", "createdClaimId": null } }
```

### POST /api/upload/prepare → `UploadPrepareResponse`

```jsonc
{
  "data": {
    "manifest": "<opaque signed token>",
    "uploads": [
      {
        "clientIndex": 0, // index into the request `files` array
        "slotId": "uuid",
        "path": "<uid>/assets/<assetId>/original",
        "token": "<storage upload token>",
      },
    ],
  },
}
```

### POST /api/upload/complete → `UploadCompleteResponse`

```jsonc
{
  "data": {
    "accepted": [
      {
        "id": "uuid",
        "slotId": "uuid", // optional
        "name": "IMG_0001.jpg",
        "capturedAt": "…", // nullable
        "state": "uploaded|processing|partial|ready",
      },
    ],
    "rejected": [{ "name": "…", "reason": "…", "slotId": "uuid" }],
    "sequenceIds": ["uuid"],
    "processingState": "ready|uploaded|processing|partial|failed",
    "message": "…", // server wording (§13)
  },
}
```

`processingState: "partial"` is a success: safely stored photos were kept and
only the failed steps stopped. Never present it as total failure.

---

## 9. Retry semantics

| Operation                    | Safe to retry | Notes                                                                                                                                                                                        |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| any `GET`                    | yes           | No side effects.                                                                                                                                                                             |
| `POST /api/gaps/:id/confirm` | **yes**       | The server derives a deterministic idempotency key from owner + gap + decision + value, so replaying the _same_ decision commits once. Replaying a _different_ decision is a new correction. |
| `POST /api/upload/prepare`   | no            | Each call reserves fresh slots and a fresh manifest. On retry, discard the previous manifest and upload to the new slots.                                                                    |
| storage `PUT` (§11)          | yes           | Same slot, same bytes, while the manifest is unexpired.                                                                                                                                      |
| `POST /api/upload/complete`  | yes           | Same manifest may be completed more than once; duplicates are detected server side. `UPLOAD_SESSION_INVALID` means start again at `prepare`.                                                 |
| `POST /api/search`           | yes           | Costs AI budget. Do not auto-retry.                                                                                                                                                          |

Backoff:

- `401 AUTH_TOKEN_INVALID` — refresh the session, retry **once**.
- `429 AI_RATE_LIMITED` — exponential backoff, minimum 5 s, max 3 attempts.
- `429 AI_COST_LIMIT` — do not retry today. Stored Memories still read fine.
- `5xx` — exponential backoff from 1 s, max 3 attempts, jittered.
- `4xx` other than 401 — never retry; it is a client bug or a user-visible state.

`/api/upload/complete` may run for up to 300 s and `/api/search` for up to 60 s.
Set the client request timeout accordingly rather than retrying an in-flight
upload.

---

## 10. Signed URL semantics

Every `imageUrl` / `representativeImageUrl` is a Supabase signed derivative URL
with a **60-second** lifetime.

**Rules:**

1. Never persist a signed URL — not in Core Data, not in `UserDefaults`, not in
   a disk image cache keyed by URL.
2. Never treat a signed URL as an identity or a cache key. The durable identities
   are `memoryId` and `assetId`; key any local cache on those.
3. When an image fails to load or the URL has aged out, refetch the owning
   resource (`GET /api/memories` or `GET /api/memories/:id`) and use the fresh
   URL. Do not attempt to re-sign client side; there is no endpoint for it.
4. A `null` `imageUrl` means "no derivative available yet", not "error". Show the
   Memory without a photo.

Practical consequence: fetch a detail screen's images promptly after loading it,
and refetch the detail if the screen has been backgrounded longer than a minute.

---

## 11. Upload sequence

```
1. POST /api/upload/prepare      → { manifest, uploads[] }
2. for each upload:  PUT <storage signed upload URL>       (direct to Supabase)
3. POST /api/upload/complete     → { accepted, rejected, processingState }
4. poll GET /api/memories until processingState is "ready"
```

Step 2 goes straight to Supabase Storage, not to this API:

```
PUT {SUPABASE_URL}/storage/v1/object/upload/sign/rememory-private/{path}?token={token}
x-upsert: false
content-type: image/jpeg          # must match the mimeType sent to prepare
cache-control: max-age=0
<raw image bytes as the body>
```

`{path}` and `{token}` come from the matching `uploads[]` entry; pair them with
the file the user picked via `clientIndex`. The `token` query parameter carries
the authorization for this one object, so the user's own access token is not
needed on this request.

Notes:

- The manifest is valid for **one hour**. Uploading after it expires makes
  `complete` answer `UPLOAD_SESSION_INVALID`; start again at `prepare`.
- Upload the bytes exactly as declared: `complete` verifies each staged object's
  size against the manifest and rejects a mismatch.
- Call `complete` once for the whole batch, not per file.
- After `complete`, reconstruction continues in the background. Poll
  `GET /api/memories` and read `processingState` / `partial`.

---

## 12. Security constraints

What the server guarantees:

- **Ownership.** Every read and write is scoped to the identity in the token. A
  bearer client reads through a Row-Level-Security session bound to that token,
  so another user's rows are not reachable — cross-user read returns empty, and
  cross-user write returns 404 without touching the database.
- **No body-supplied identity.** The owner comes from the verified token only.
- **No CSRF relaxation for browsers.** Cookie and preview mutations keep the
  same-origin assertion exactly as before. The origin check is skipped only for
  requests that carry an `Authorization` header — those spend no ambient
  credential, and browser code cannot attach that header cross-origin without a
  CORS preflight this app does not answer.
- **No CORS wildcard.** The API sends no `Access-Control-Allow-Origin`. A native
  client is unaffected; a foreign web page is still locked out.
- **No preview fallback for tokens.** An unusable token is a 401, never a new
  Public Preview account.

What the client must guarantee:

- Store the access token in the Keychain. Never in `UserDefaults`, never in a
  file, never in a log.
- Never print, breadcrumb, or crash-report the token, the `Authorization` header,
  or a signed storage URL.
- Send the token over TLS only.
- Log `requestId` for support, never request or response bodies — they contain
  private memory content.
- Use `X-Request-Id` (≤100 chars, `[A-Za-z0-9._-]`) if you want your own
  correlation id echoed back in errors.

---

## 13. Swift presentation mapping

The transport vocabulary is backend implementation language. It stops at the
networking layer. Views see presentation types only.

| Transport (DTO)                                     | Presentation (SwiftUI)                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `MemoryThreadTransport.memories[]`                  | `[Memory]`                                                                             |
| `representatives.identity / keyMoment / complement` | `Memory.heroPhotos: [Photo]` — ordered identity → keyMoment → complement, nils dropped |
| `claims[]`                                          | `Memory.memoryContent: [MemoryContent]`                                                |
| `evidence[]` where `kind == "photo"`                | `Memory.supportingPhotos: [SupportingPhoto]`                                           |
| `relatedMemories[]`                                 | `Memory.relatedMemories: [RelatedMemory]`                                              |
| `ConfirmationQueueTransport.gaps[]`                 | `[ConfirmationRequest]`                                                                |
| `{ memoryId, assetId }`                             | stable identity for diffing and caching                                                |
| `imageUrl`, `representativeImageUrl`                | `Photo.temporaryURL` — transport only, never stored                                    |

The view layer must not know these words:

`identity` · `keyMoment` · `complement` · `Claim` · `Evidence` ·
`UserCorrection` · `MemoryGap` · `relation_type` · `confidence_band` ·
`AI Run` · `embedding` · `RRF` · `origin` · `dimension`

`state` and `processingState` do cross the boundary, because they are the user's
truth model, not an implementation detail. Map them to a presentation enum rather
than switching on raw strings in a view.

### No copy coupling

These fields are server-generated wording that exists for the current web client:

- `relationLabel` — `"「…」と同じ場所"`
- `partialMessage`
- `claims[].text` — `"field: value"`
- `evidence[].label`, `evidence[].sourceLabel`
- `message` on upload completion

They are **not** removed (the web client still needs them), but a native layout
must not be built around them. This UI is layout-first: compose native copy from
structured fields (`relationType`, `relationState`, `state`, `processingState`,
`capturedAt`, `placeLabel`, `photoCount`), and treat server strings as optional
fallback text that may be any length or absent.

---

## 14. Versioning rules

**Additive without notice** — a client must tolerate these:

- new optional fields on any response
- new endpoints
- new `code` values in the error envelope
- new members of `kind` on evidence
- changes to any Japanese `message` / `partialMessage` / `relationLabel` text
- any change inside `/api/search`

**Requires a new contract version (`v2`)** — these will not happen silently:

- removing or renaming a field on a stable endpoint
- narrowing a type, or removing a member of `state`, `processingState`,
  `relationType`, `relationState`, or `origin`
- changing the success or error envelope
- changing the auth modes or the upload sequence

**Decoding rules for the client:**

1. Decode unknown fields permissively; ignore what you do not model.
2. Decode unknown enum members into an explicit `unknown` case and render a safe
   neutral state. Never `fatalError` on decode.
3. Pin nothing to array order except where this document states an order.
4. Re-verify against `src/contracts/client-api-v1.ts` whenever the backend
   branch moves; those schemas are asserted against real route responses in
   `tests/integration/client-api-v1-contract.test.ts`.
