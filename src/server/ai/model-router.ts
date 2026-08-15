import { z } from "zod";

import type { AIModelRole, AIPurpose } from "./provider";

export const AIModelConfigSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    inputUsdPerMillionTokens: z.number().nonnegative().max(10_000),
    outputUsdPerMillionTokens: z.number().nonnegative().max(10_000),
    imageUsdEach: z.number().nonnegative().max(100),
    maxOutputTokens: z.number().int().positive().max(32_000),
    /** Optional per-role endpoint override (e.g. a local model for one role). */
    baseUrl: z.url().optional(),
  })
  .strict();

export type AIModelConfig = z.infer<typeof AIModelConfigSchema>;
export type AIModelCatalog = Record<AIModelRole, AIModelConfig>;

export interface ModelRoutingRequest {
  purpose: AIPurpose;
  allowStrongModel: boolean;
  complexity?: "normal" | "high";
}

export function routeModelRole(request: ModelRoutingRequest): AIModelRole {
  switch (request.purpose) {
    case "analyze_sequence":
      return "VISION_CHEAP";
    case "generate_event_claims":
      return request.allowStrongModel && request.complexity === "high"
        ? "EVENT_STRONG"
        : "EVENT_CHEAP";
    case "detect_memory_gap":
      return "EVENT_CHEAP";
    case "parse_search_query":
    case "rerank_search_candidates":
    case "generate_grounded_answer":
      return "CHAT_CHEAP";
  }
}

export function parseModelCatalog(raw: unknown): AIModelCatalog {
  return z
    .object({
      VISION_CHEAP: AIModelConfigSchema,
      EVENT_CHEAP: AIModelConfigSchema,
      CHAT_CHEAP: AIModelConfigSchema,
      EVENT_STRONG: AIModelConfigSchema,
    })
    .strict()
    .parse(raw);
}
