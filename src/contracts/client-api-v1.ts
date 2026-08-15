/**
 * Client API v1 — the transport contract a native client may depend on.
 *
 * This module describes what the existing HTTP routes already return. It is a
 * description, not a transformation: nothing here may change a Memory Core
 * structure, a truth semantic, or a ranking decision. When a route and a schema
 * disagree, the route is right and the schema is wrong.
 *
 * Layering rules that this file exists to protect:
 *
 *   Backend Domain    Claim, Evidence, UserCorrection, MemoryGap, Distillation,
 *                     identity / key_moment / complement, relation_type, AI Run,
 *                     embedding, RRF. Not represented here.
 *   Transport DTO     this file. Mirrors backend JSON exactly, including the
 *                     implementation vocabulary the web client already reads.
 *   Presentation      Memory, Photo, MemoryContent, SupportingPhoto,
 *                     RelatedMemory, ConfirmationRequest. Defined on the Swift
 *                     side only; see docs/api/CLIENT_API_V1.md.
 *
 * Only a networking layer may import the transport names. A view must not.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Envelopes
 * ------------------------------------------------------------------ */

/** Every 2xx body is `{ "data": <payload> }`. */
export const ApiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data });

/** Every non-2xx body is `{ "error": { code, message, requestId? } }`. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Error codes a client is expected to branch on. The list is open: an unknown
 * code must be handled as a generic failure of its HTTP status, never as a
 * crash.
 */
export const API_ERROR_CODES = [
  "AUTH_TOKEN_INVALID",
  "AUTH_REQUIRED",
  "ORIGIN_REJECTED",
  "INVALID_INPUT",
  "MEMORY_NOT_FOUND",
  "GAP_NOT_FOUND",
  "GAP_NOT_ANSWERABLE",
  "TOO_MANY_FILES",
  "FILE_TOO_LARGE",
  "UPLOAD_SESSION_INVALID",
  "AI_RATE_LIMITED",
  "AI_COST_LIMIT",
  "AI_UNAVAILABLE",
  "SERVICE_NOT_CONFIGURED",
  "INTERNAL_ERROR",
] as const;

/* ------------------------------------------------------------------ *
 * Shared transport vocabulary
 * ------------------------------------------------------------------ */

/**
 * Truth state of a Memory or a Claim. A client may map this to styling but must
 * not reinterpret it, invent a new member, or reorder its precedence.
 */
export const EpistemicStateSchema = z.enum([
  "evidence",
  "confirmed",
  "inferred",
  "unknown",
  "disputed",
]);

export const ProcessingStateSchema = z.enum([
  "ready",
  "uploaded",
  "processing",
  "partial",
  "failed",
]);

/**
 * A signed, short-lived storage URL. It is transport, not identity: never
 * persist it, never key a cache on it, and refetch the owning resource once it
 * stops loading. Persist `memoryId` / `assetId` instead.
 */
export const SignedImageUrlSchema = z.string().nullable();

export const MemoryThreadItemTransportSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  capturedAt: z.string().nullable(),
  placeLabel: z.string().nullable(),
  photoCount: z.number().int().nonnegative(),
  representativeImageUrl: SignedImageUrlSchema,
  representativeImageAlt: z.string().nullable().optional(),
  state: EpistemicStateSchema,
  processingState: ProcessingStateSchema.optional(),
  summary: z.string().nullable().optional(),
  // Server-generated wording. Present for web compatibility; a native layout
  // must not be built around it.
  relationLabel: z.string().nullable().optional(),
  relationState: z.enum(["confirmed", "inferred"]).nullable().optional(),
  hasOpenGap: z.boolean().optional(),
  evidenceCount: z.number().int().nonnegative().optional(),
});

export type MemoryThreadItemTransport = z.infer<
  typeof MemoryThreadItemTransportSchema
>;

/* ------------------------------------------------------------------ *
 * Stable — GET /api/memories
 * ------------------------------------------------------------------ */

export const MemoryThreadTransportSchema = z.object({
  memories: z.array(MemoryThreadItemTransportSchema),
  pendingConfirmationCount: z.number().int().nonnegative().optional(),
  partial: z.boolean().optional(),
  partialMessage: z.string().nullable().optional(),
});

export type MemoryThreadTransport = z.infer<typeof MemoryThreadTransportSchema>;

/* ------------------------------------------------------------------ *
 * Stable — GET /api/memories/:id
 * ------------------------------------------------------------------ */

/**
 * One distilled representative photo. `identity` / `keyMoment` / `complement`
 * are Backend Domain roles: a client maps them to an ordered photo list and
 * does not surface the role names.
 */
export const RepresentativePhotoTransportSchema = z.object({
  assetId: z.uuid(),
  imageUrl: SignedImageUrlSchema,
  alt: z.string(),
});

export const MemoryRepresentativesTransportSchema = z.object({
  identity: RepresentativePhotoTransportSchema.nullable(),
  keyMoment: RepresentativePhotoTransportSchema.nullable(),
  complement: RepresentativePhotoTransportSchema.nullable(),
});

export const RelatedMemoryTransportSchema = z.object({
  memoryId: z.uuid(),
  title: z.string(),
  capturedAt: z.string().nullable(),
  relationType: z.enum(["before", "same_place", "same_activity"]),
  relationState: z.enum(["confirmed", "inferred"]),
  representativeImageUrl: SignedImageUrlSchema,
});

export const ClaimTransportSchema = z.object({
  id: z.uuid(),
  // Server-composed `field: value` text. Web-compatible; not a native layout
  // primitive.
  text: z.string(),
  state: EpistemicStateSchema,
  origin: z.enum(["deterministic", "ai", "user"]),
  evidenceIds: z.array(z.uuid()),
});

export const EvidenceTransportSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  detail: z.string().nullable().optional(),
  kind: z.enum([
    "photo",
    "metadata",
    "user_correction",
    "related_memory",
    "other",
  ]),
  sourceLabel: z.string().nullable().optional(),
  imageUrl: SignedImageUrlSchema.optional(),
  capturedAt: z.string().nullable().optional(),
});

export const MemoryDetailTransportSchema = z.object({
  memory: MemoryThreadItemTransportSchema.extend({
    description: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  }),
  representatives: MemoryRepresentativesTransportSchema.optional(),
  relatedMemories: z.array(RelatedMemoryTransportSchema).optional(),
  reconstruction: z.string().nullable().optional(),
  claims: z.array(ClaimTransportSchema),
  evidence: z.array(EvidenceTransportSchema),
  partial: z.boolean().optional(),
  partialMessage: z.string().nullable().optional(),
});

export type MemoryDetailTransport = z.infer<typeof MemoryDetailTransportSchema>;

/* ------------------------------------------------------------------ *
 * Stable — GET /api/gaps, POST /api/gaps/:id/confirm
 * ------------------------------------------------------------------ */

export const MemoryGapTransportSchema = z.object({
  id: z.uuid(),
  memoryId: z.uuid(),
  memoryTitle: z.string(),
  question: z.string().min(1),
  candidateLabel: z.string().nullable().optional(),
  evidenceSummary: z.string().nullable().optional(),
  state: z.enum(["open", "answered", "skipped"]),
});

export const ConfirmationQueueTransportSchema = z.object({
  gaps: z.array(MemoryGapTransportSchema),
  partial: z.boolean().optional(),
  partialMessage: z.string().nullable().optional(),
});

export type ConfirmationQueueTransport = z.infer<
  typeof ConfirmationQueueTransportSchema
>;

/**
 * Request body for POST /api/gaps/:id/confirm. The route parses with `.strict()`
 * per member, so `correctionText` must be absent unless the decision is
 * `correct`.
 */
export const ConfirmationMutationRequestSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({ decision: z.literal("confirm") }).strict(),
    z.object({ decision: z.literal("later") }).strict(),
    z
      .object({
        decision: z.literal("correct"),
        correctionText: z.string().trim().min(1).max(500),
      })
      .strict(),
  ],
);

export type ConfirmationMutationRequest = z.infer<
  typeof ConfirmationMutationRequestSchema
>;

export const ConfirmationMutationResponseSchema = z.union([
  z.object({
    saved: z.literal(true),
    deferred: z.literal(true),
    deferredUntil: z.string(),
    createdClaimId: z.null(),
  }),
  z.object({
    saved: z.literal(true),
    createdClaimId: z.uuid().nullable(),
  }),
]);

export type ConfirmationMutationResponse = z.infer<
  typeof ConfirmationMutationResponseSchema
>;

/* ------------------------------------------------------------------ *
 * Stable — POST /api/upload/prepare, POST /api/upload/complete
 * ------------------------------------------------------------------ */

export const UploadMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const UploadPrepareRequestSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(500),
            mimeType: UploadMimeTypeSchema,
            bytes: z
              .number()
              .int()
              .positive()
              .max(100 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type UploadPrepareRequest = z.infer<typeof UploadPrepareRequestSchema>;

/**
 * `manifest` is an opaque signed token: echo it back to /api/upload/complete
 * unmodified. `uploads[].clientIndex` is the index into the request `files`
 * array, so a client can pair each slot with the file it chose.
 */
export const UploadPrepareResponseSchema = z.object({
  manifest: z.string().min(1),
  uploads: z.array(
    z.object({
      clientIndex: z.number().int().nonnegative(),
      slotId: z.uuid(),
      path: z.string().min(1),
      token: z.string().min(1),
    }),
  ),
});

export type UploadPrepareResponse = z.infer<typeof UploadPrepareResponseSchema>;

export const UploadCompleteRequestSchema = z
  .object({
    manifest: z.string().min(1).max(32_000),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).nullable(),
    timezone: z.string().max(100).optional(),
    coarsePlace: z.string().max(80).nullable().optional(),
  })
  .strict();

export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;

export const UploadCompleteResponseSchema = z.object({
  accepted: z.array(
    z.object({
      id: z.uuid(),
      slotId: z.uuid().optional(),
      name: z.string(),
      capturedAt: z.string().nullable(),
      state: z.enum(["uploaded", "processing", "partial", "ready"]),
    }),
  ),
  rejected: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
      slotId: z.uuid().optional(),
    }),
  ),
  sequenceIds: z.array(z.uuid()).optional(),
  processingState: ProcessingStateSchema,
  message: z.string().nullable().optional(),
});

export type UploadCompleteResponse = z.infer<
  typeof UploadCompleteResponseSchema
>;

/* ------------------------------------------------------------------ *
 * Provisional — POST /api/search
 * ------------------------------------------------------------------ */

export const SearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    timezone: z.string().min(1).max(80).default("Asia/Tokyo"),
    currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    cellId: z.string().trim().optional(),
  })
  .strict();

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

/**
 * PROVISIONAL. Only the envelope below is recorded, and only so a client can
 * parse a response without crashing.
 *
 * Hybrid retrieval, FTS, vector search, and RRF are expected to change, so a
 * native UI must not freeze: candidate ordering, any score, `matchReasons`
 * wording, `sources[]` and its label wording, or the internal shape of a
 * candidate. The envelope and each candidate are parsed loosely for exactly
 * that reason — treat every field beyond `memory` as advisory.
 */
export const SearchResponseStableSurfaceSchema = z.looseObject({
  interpretation: z
    .object({
      time: z.string().nullable().optional(),
      place: z.string().nullable().optional(),
      people: z.array(z.string()).optional(),
      activities: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
    })
    .loose(),
  answer: z.string().nullable().optional(),
  answerState: z.enum(["grounded", "unknown", "clarification"]).optional(),
  candidates: z.array(
    z.object({ memory: MemoryThreadItemTransportSchema }).loose(),
  ),
  clarification: z.string().nullable().optional(),
  partial: z.boolean().optional(),
  partialMessage: z.string().nullable().optional(),
  feedbackEnabled: z.boolean().optional(),
});

export type SearchResponseStableSurface = z.infer<
  typeof SearchResponseStableSurfaceSchema
>;
