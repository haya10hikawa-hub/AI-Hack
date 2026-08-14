import { z } from "zod";

import {
  normalizeAssetSemanticRepresentations,
  type AssetSemanticRepresentation,
  type EventFacetType,
} from "../../domain/event-semantics";
import {
  GroundedAnswerOutputSchema,
  GroundedFactInputSchema,
} from "../../domain/grounded-answer";
import { JsonValueSchema } from "../../domain/json";
import { validateImageBytes } from "../../domain/media-validation";
import {
  ContextDimensionSchema,
  GapOptionSchema,
  ImportanceBandSchema,
  MemoryGapTypeSchema,
} from "../../domain/memory-assessment";
import { ParsedMemoryQuerySchema } from "../../domain/search";

const IdentifierSchema = z.string().min(1).max(200);
const SafeTextSchema = z.string().trim().min(1).max(500);

export const AIInvocationContextSchema = z
  .object({
    /** Authenticated owner id. It is used for gates and is never sent to the model. */
    userId: IdentifierSchema,
    requestId: IdentifierSchema,
    allowStrongModel: z.boolean().default(false),
  })
  .strict();

export type AIInvocationContext = z.infer<typeof AIInvocationContextSchema>;

export const SequenceAnalysisInputSchema = z
  .object({
    sequenceId: IdentifierSchema,
    assets: z
      .array(
        z
          .object({
            assetId: IdentifierSchema,
            mimeType: z.enum(["image/jpeg", "image/webp"]),
            /** Metadata-stripped, resized derivative only. Never an original or URL. */
            derivativeBase64: z
              .string()
              .min(4)
              .max(12_000_000)
              .regex(
                /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
              ),
            width: z.number().int().positive().max(4096),
            height: z.number().int().positive().max(4096),
            capturedAt: z.string().datetime({ offset: true }).nullable(),
            coarsePlace: z.string().trim().min(1).max(100).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

export type SequenceAnalysisInput = z.infer<typeof SequenceAnalysisInputSchema>;

export const SequenceAnalysisOutputSchema = z
  .object({
    observations: z
      .array(
        z
          .object({
            assetId: IdentifierSchema,
            field: z.enum([
              "activity",
              "object",
              "people_group",
              "environment",
              "moment",
              "detail",
              "visible_text",
              "visual_change",
            ]),
            value: SafeTextSchema,
            confidenceBand: z.enum(["low", "medium", "high"]),
            uncertainty: z.string().trim().max(300).nullable(),
          })
          .strict()
          .refine(
            ({ confidenceBand, uncertainty }) =>
              confidenceBand !== "low" || uncertainty !== null,
            { message: "Low-confidence observations require uncertainty." },
          ),
      )
      .max(50),
  })
  .strict();

export type SequenceAnalysisOutput = z.infer<
  typeof SequenceAnalysisOutputSchema
>;

export const EventClaimsInputSchema = z
  .object({
    memoryId: IdentifierSchema,
    evidence: z
      .array(
        z
          .object({
            evidenceId: IdentifierSchema,
            field: z.string().trim().min(1).max(80),
            value: JsonValueSchema,
            sourceType: z.enum([
              "metadata",
              "ai_observation",
              "location",
              "system",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type EventClaimsInput = z.infer<typeof EventClaimsInputSchema>;

export const EventClaimsOutputSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(80),
            value: JsonValueSchema,
            evidenceIds: z.array(IdentifierSchema).min(1).max(20),
            confidenceBand: z.enum(["low", "medium", "high"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export type EventClaimsOutput = z.infer<typeof EventClaimsOutputSchema>;

export const GapDetectionInputSchema = z
  .object({
    memoryId: IdentifierSchema,
    importanceBand: ImportanceBandSchema,
    missingDimensions: z.array(ContextDimensionSchema).max(7),
    knownFacts: z.array(GroundedFactInputSchema).max(50),
    evidence: z
      .array(
        z
          .object({
            evidenceId: IdentifierSchema,
            field: z.string().trim().min(1).max(80),
            value: JsonValueSchema,
            sourceType: z.enum([
              "metadata",
              "ai_observation",
              "location",
              "system",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type GapDetectionInput = z.infer<typeof GapDetectionInputSchema>;

export const GapDetectionOutputSchema = z
  .object({
    hasValuableGap: z.boolean(),
    candidate: z
      .object({
        dimension: ContextDimensionSchema,
        gapType: MemoryGapTypeSchema,
        question: z.string().trim().min(1).max(200),
        options: z.array(GapOptionSchema).min(2).max(5),
        candidateOptionValue: z.string().trim().min(1).max(80),
        candidateValue: JsonValueSchema,
        evidenceIds: z.array(IdentifierSchema).min(1).max(20),
        confidenceBand: z.enum(["low", "medium", "high"]),
        candidateSpecificity: z.number().min(0).max(1),
      })
      .strict()
      .superRefine((candidate, context) => {
        const optionValues = candidate.options.map(({ value }) => value);
        if (new Set(optionValues).size !== optionValues.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: "Gap option values must be unique.",
          });
        }
        if (
          !candidate.options.some(
            ({ value }) => value === candidate.candidateOptionValue,
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["candidateOptionValue"],
            message:
              "The positive candidate must identify one supplied option.",
          });
        }
        if (candidate.candidateValue === null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["candidateValue"],
            message: "A positive gap candidate must bind a concrete fact.",
          });
        }
      })
      .nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.hasValuableGap !== (result.candidate !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidate"],
        message:
          "candidate must be present exactly when hasValuableGap is true.",
      });
    }
  });

export type GapDetectionOutput = z.infer<typeof GapDetectionOutputSchema>;

export const QueryParsingInputSchema = z
  .object({
    rawQuery: z.string().trim().min(1).max(500),
    confirmedAliases: z
      .array(
        z
          .object({
            from: z.string().trim().min(1).max(100),
            to: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    timezone: z.string().min(1).max(80),
  })
  .strict();

export type QueryParsingInput = z.infer<typeof QueryParsingInputSchema>;

export const QueryParsingOutputSchema = ParsedMemoryQuerySchema;
export type QueryParsingOutput = z.infer<typeof QueryParsingOutputSchema>;

export const RerankInputSchema = z
  .object({
    query: ParsedMemoryQuerySchema,
    candidates: z
      .array(
        z
          .object({
            memoryId: IdentifierSchema,
            date: z.string().max(40).nullable(),
            coarsePlace: z.string().trim().max(100).nullable(),
            title: z.string().trim().min(1).max(160),
            groundedTerms: z.array(z.string().trim().min(1).max(100)).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export type RerankInput = z.infer<typeof RerankInputSchema>;

export const RerankOutputSchema = z
  .object({
    ranked: z
      .array(
        z
          .object({
            memoryId: IdentifierSchema,
            score: z.number().min(0).max(1),
            matchReasons: z
              .array(z.string().trim().min(1).max(120))
              .min(1)
              .max(6),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export type RerankOutput = z.infer<typeof RerankOutputSchema>;

export const GroundedAnswerInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    facts: z.array(GroundedFactInputSchema).max(100),
    allowedClarificationQuestion: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export type GroundedAnswerInput = z.infer<typeof GroundedAnswerInputSchema>;
export const GroundedAnswerAIOutputSchema = GroundedAnswerOutputSchema;
export type GroundedAnswerAIOutput = z.infer<
  typeof GroundedAnswerAIOutputSchema
>;

export function assertSequenceAnalysisReferences(
  output: SequenceAnalysisOutput,
  input: SequenceAnalysisInput,
): void {
  const allowed = new Set(input.assets.map(({ assetId }) => assetId));
  if (output.observations.some(({ assetId }) => !allowed.has(assetId))) {
    throw new Error("Sequence analysis referenced an asset outside its input.");
  }
}

export function toAssetSemanticRepresentations(
  output: SequenceAnalysisOutput,
): AssetSemanticRepresentation[] {
  const byAsset = new Map<string, AssetSemanticRepresentation["facets"]>();
  for (const observation of output.observations) {
    const type: EventFacetType =
      observation.field === "visual_change" ? "moment" : observation.field;
    byAsset.set(observation.assetId, [
      ...(byAsset.get(observation.assetId) ?? []),
      {
        type,
        value: observation.value,
        confidenceBand: observation.confidenceBand,
        uncertainty: observation.uncertainty,
      },
    ]);
  }
  return normalizeAssetSemanticRepresentations(
    [...byAsset].map(([assetId, facets]) => ({ assetId, facets })),
  );
}

export function assertPrivacySafeSequenceInput(
  input: SequenceAnalysisInput,
): void {
  for (const asset of input.assets) {
    const bytes = decodeBase64(asset.derivativeBase64);
    const validation = validateImageBytes({
      bytes,
      declaredMimeType: asset.mimeType,
      limits: {
        maxBytes: 10 * 1024 * 1024,
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 4096 * 4096,
      },
    });
    if (
      !validation.ok ||
      validation.width !== asset.width ||
      validation.height !== asset.height
    ) {
      throw new Error("Vision derivative failed media validation.");
    }
    if (
      containsBytes(bytes, [0x45, 0x78, 0x69, 0x66, 0, 0]) ||
      containsBytes(bytes, [0x45, 0x58, 0x49, 0x46]) ||
      containsBytes(bytes, [0x58, 0x4d, 0x50, 0x20]) ||
      containsBytes(
        bytes,
        [
          0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73, 0x2e, 0x61,
          0x64, 0x6f, 0x62, 0x65,
        ],
      )
    ) {
      throw new Error("Vision derivative still contains private metadata.");
    }
  }
}

export function assertEventClaimReferences(
  output: EventClaimsOutput,
  input: EventClaimsInput,
): void {
  const allowed = new Set(input.evidence.map(({ evidenceId }) => evidenceId));
  if (
    output.claims.some(({ evidenceIds }) =>
      evidenceIds.some((evidenceId) => !allowed.has(evidenceId)),
    )
  ) {
    throw new Error("Generated claim referenced evidence outside its input.");
  }
}

export function assertGapReferences(
  output: GapDetectionOutput,
  input: GapDetectionInput,
): void {
  if (
    output.candidate !== null &&
    !input.missingDimensions.includes(output.candidate.dimension)
  ) {
    throw new Error(
      "Gap detector selected a context dimension that is not missing.",
    );
  }
  if (output.candidate !== null) {
    const allowedEvidence = new Set(
      input.evidence.map(({ evidenceId }) => evidenceId),
    );
    if (
      output.candidate.evidenceIds.some(
        (evidenceId) => !allowedEvidence.has(evidenceId),
      )
    ) {
      throw new Error("Gap candidate referenced evidence outside its input.");
    }
  }
}

export function assertRerankReferences(
  output: RerankOutput,
  input: RerankInput,
): void {
  const allowed = new Set(input.candidates.map(({ memoryId }) => memoryId));
  const seen = new Set<string>();
  for (const candidate of output.ranked) {
    if (!allowed.has(candidate.memoryId) || seen.has(candidate.memoryId)) {
      throw new Error("Reranker returned an unknown or duplicate memory id.");
    }
    seen.add(candidate.memoryId);
  }
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function containsBytes(bytes: Uint8Array, needle: readonly number[]): boolean {
  if (needle.length === 0 || needle.length > bytes.length) return false;
  outer: for (
    let start = 0;
    start <= bytes.length - needle.length;
    start += 1
  ) {
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}
