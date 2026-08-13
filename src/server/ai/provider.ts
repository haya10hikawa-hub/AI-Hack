import type {
  AIInvocationContext,
  EventClaimsInput,
  EventClaimsOutput,
  GapDetectionInput,
  GapDetectionOutput,
  GroundedAnswerAIOutput,
  GroundedAnswerInput,
  QueryParsingInput,
  QueryParsingOutput,
  RerankInput,
  RerankOutput,
  SequenceAnalysisInput,
  SequenceAnalysisOutput,
} from "./schemas";

export type AIModelRole =
  | "VISION_CHEAP"
  | "EVENT_CHEAP"
  | "CHAT_CHEAP"
  | "EVENT_STRONG";

export type AIPurpose =
  | "analyze_sequence"
  | "generate_event_claims"
  | "detect_memory_gap"
  | "parse_search_query"
  | "rerank_search_candidates"
  | "generate_grounded_answer";

export interface AIRunMetadata {
  purpose: AIPurpose;
  provider: string;
  model: string;
  modelRole: AIModelRole;
  promptVersion: string;
  schemaVersion: string;
  inputAssets: number;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  retryCount: number;
  estimatedCostUsd: number;
  status: "success" | "failed" | "timeout" | "rate_limited" | "invalid_output";
}

export interface AIProviderResult<T> {
  data: T;
  run: AIRunMetadata;
}

export interface AIProvider {
  analyzeSequence(
    context: AIInvocationContext,
    input: SequenceAnalysisInput,
  ): Promise<AIProviderResult<SequenceAnalysisOutput>>;
  generateEventClaims(
    context: AIInvocationContext,
    input: EventClaimsInput,
  ): Promise<AIProviderResult<EventClaimsOutput>>;
  detectMemoryGap(
    context: AIInvocationContext,
    input: GapDetectionInput,
  ): Promise<AIProviderResult<GapDetectionOutput>>;
  parseSearchQuery(
    context: AIInvocationContext,
    input: QueryParsingInput,
  ): Promise<AIProviderResult<QueryParsingOutput>>;
  rerankSearchCandidates(
    context: AIInvocationContext,
    input: RerankInput,
  ): Promise<AIProviderResult<RerankOutput>>;
  generateGroundedAnswer(
    context: AIInvocationContext,
    input: GroundedAnswerInput,
  ): Promise<AIProviderResult<GroundedAnswerAIOutput>>;
}

export type AIErrorCode =
  | "configuration_error"
  | "rate_limited"
  | "cost_limit"
  | "provider_error"
  | "timeout"
  | "invalid_output";

export class AIProviderError extends Error {
  auditRun: AIRunMetadata | null = null;

  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIProviderError";
  }

  withAuditRun(run: AIRunMetadata): this {
    this.auditRun ??= run;
    return this;
  }
}
