import "server-only";

import { z } from "zod";

import { canonicalizeGroundedAnswerText } from "../../domain/grounded-answer";
import { parseMemoryQueryOutput } from "../../domain/search";
import type { RateLimiter } from "../security/rate-limit";
import {
  estimateAIActualCost,
  estimateAIRequestCost,
  type AICostGuard,
} from "./cost-guard";
import {
  parseModelCatalog,
  routeModelRole,
  type AIModelCatalog,
  type AIModelConfig,
} from "./model-router";
import {
  AIProviderError,
  type AIModelRole,
  type AIPurpose,
  type AIProvider,
  type AIProviderResult,
  type AIRunMetadata,
} from "./provider";
import { serializeUntrustedData, systemPromptFor } from "./prompts";
import {
  AIInvocationContextSchema,
  EventClaimsInputSchema,
  EventClaimsOutputSchema,
  GapDetectionInputSchema,
  GapDetectionOutputSchema,
  GroundedAnswerAIOutputSchema,
  GroundedAnswerInputSchema,
  QueryParsingInputSchema,
  QueryParsingOutputSchema,
  RerankInputSchema,
  RerankOutputSchema,
  SequenceAnalysisInputSchema,
  SequenceAnalysisOutputSchema,
  assertEventClaimReferences,
  assertGapReferences,
  assertPrivacySafeSequenceInput,
  assertRerankReferences,
  assertSequenceAnalysisReferences,
  canonicalizeSequenceAnalysis,
  type AIInvocationContext,
  type EventClaimsInput,
  type EventClaimsOutput,
  type GapDetectionInput,
  type GapDetectionOutput,
  type GroundedAnswerAIOutput,
  type GroundedAnswerInput,
  type QueryParsingInput,
  type QueryParsingOutput,
  type RerankInput,
  type RerankOutput,
  type SequenceAnalysisInput,
  type SequenceAnalysisOutput,
} from "./schemas";

const CompletionEnvelopeSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().min(1),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type FetchLike = typeof fetch;

export interface OrcaRouterProviderConfig {
  apiKey: string;
  baseUrl: string;
  models: AIModelCatalog;
  rateLimiter: RateLimiter;
  costGuard: AICostGuard;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  promptVersion?: string;
  schemaVersion?: string;
}

interface Invocation<T> {
  purpose: AIPurpose;
  context: AIInvocationContext;
  input: unknown;
  schema: z.ZodType<T>;
  inputImages: number;
  imageParts?: Array<{ mimeType: "image/jpeg" | "image/webp"; base64: string }>;
  complexity?: "normal" | "high";
  postValidate?: (output: T) => void;
}

export class OrcaRouterProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly endpoint: URL;
  private readonly models: AIModelCatalog;
  private readonly rateLimiter: RateLimiter;
  private readonly costGuard: AICostGuard;
  private readonly fetchImplementation: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResponseBytes: number;
  private readonly promptVersion: string;
  private readonly schemaVersion: string;

  constructor(config: OrcaRouterProviderConfig) {
    assertServerRuntime();
    this.apiKey = z.string().trim().min(1).parse(config.apiKey);
    this.endpoint = completionEndpoint(config.baseUrl);
    this.models = parseModelCatalog(config.models);
    this.rateLimiter = config.rateLimiter;
    this.costGuard = config.costGuard;
    this.fetchImplementation = config.fetchImplementation ?? fetch;
    this.timeoutMs = z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .parse(config.timeoutMs ?? 30_000);
    this.maxRetries = z
      .number()
      .int()
      .min(0)
      .max(1)
      .parse(config.maxRetries ?? 1);
    this.maxResponseBytes = z
      .number()
      .int()
      .min(1_024)
      .max(5_000_000)
      .parse(config.maxResponseBytes ?? 512_000);
    this.promptVersion = z
      .string()
      .min(1)
      .max(100)
      .parse(config.promptVersion ?? "v1");
    this.schemaVersion = z
      .string()
      .min(1)
      .max(100)
      .parse(config.schemaVersion ?? "v1");
  }

  async analyzeSequence(
    rawContext: AIInvocationContext,
    rawInput: SequenceAnalysisInput,
  ): Promise<AIProviderResult<SequenceAnalysisOutput>> {
    const context = AIInvocationContextSchema.parse(rawContext);
    const input = SequenceAnalysisInputSchema.parse(rawInput);
    assertPrivacySafeSequenceInput(input);
    const promptInput = {
      sequenceId: input.sequenceId,
      assets: input.assets.map(
        ({ assetId, mimeType, width, height, capturedAt, coarsePlace }) => ({
          assetId,
          mimeType,
          width,
          height,
          capturedAt,
          coarsePlace,
        }),
      ),
    };
    const result = await this.invoke({
      purpose: "analyze_sequence",
      context,
      input: promptInput,
      schema: SequenceAnalysisOutputSchema,
      inputImages: input.assets.length,
      imageParts: input.assets.map(({ mimeType, derivativeBase64 }) => ({
        mimeType,
        base64: derivativeBase64,
      })),
      postValidate: (output) => assertSequenceAnalysisReferences(output, input),
    });
    return { ...result, data: canonicalizeSequenceAnalysis(result.data) };
  }

  async generateEventClaims(
    rawContext: AIInvocationContext,
    rawInput: EventClaimsInput,
  ): Promise<AIProviderResult<EventClaimsOutput>> {
    const context = AIInvocationContextSchema.parse(rawContext);
    const input = EventClaimsInputSchema.parse(rawInput);
    return this.invoke({
      purpose: "generate_event_claims",
      context,
      input,
      schema: EventClaimsOutputSchema,
      inputImages: 0,
      complexity: input.evidence.length > 30 ? "high" : "normal",
      postValidate: (output) => assertEventClaimReferences(output, input),
    });
  }

  async detectMemoryGap(
    rawContext: AIInvocationContext,
    rawInput: GapDetectionInput,
  ): Promise<AIProviderResult<GapDetectionOutput>> {
    const context = AIInvocationContextSchema.parse(rawContext);
    const input = GapDetectionInputSchema.parse(rawInput);
    return this.invoke({
      purpose: "detect_memory_gap",
      context,
      input,
      schema: GapDetectionOutputSchema,
      inputImages: 0,
      postValidate: (output) => assertGapReferences(output, input),
    });
  }

  async parseSearchQuery(
    rawContext: AIInvocationContext,
    rawInput: QueryParsingInput,
  ): Promise<AIProviderResult<QueryParsingOutput>> {
    const context = AIInvocationContextSchema.parse(rawContext);
    const input = QueryParsingInputSchema.parse(rawInput);
    const result = await this.invoke({
      purpose: "parse_search_query",
      context,
      input,
      schema: QueryParsingOutputSchema,
      inputImages: 0,
      postValidate: (output) => {
        parseMemoryQueryOutput(output, input.rawQuery);
        const allowedAliases = new Set(
          input.confirmedAliases.map(({ from, to }) => `${from}\0${to}`),
        );
        if (
          output.aliasesApplied.some(
            (alias) =>
              alias.source !== "user_confirmed" ||
              !allowedAliases.has(`${alias.from}\0${alias.to}`),
          )
        ) {
          throw new Error("Query parser invented a confirmed alias.");
        }
      },
    });
    return {
      ...result,
      data: parseMemoryQueryOutput(result.data, input.rawQuery),
    };
  }

  async rerankSearchCandidates(
    rawContext: AIInvocationContext,
    rawInput: RerankInput,
  ): Promise<AIProviderResult<RerankOutput>> {
    const context = AIInvocationContextSchema.parse(rawContext);
    const input = RerankInputSchema.parse(rawInput);
    return this.invoke({
      purpose: "rerank_search_candidates",
      context,
      input,
      schema: RerankOutputSchema,
      inputImages: 0,
      postValidate: (output) => assertRerankReferences(output, input),
    });
  }

  async generateGroundedAnswer(
    rawContext: AIInvocationContext,
    rawInput: GroundedAnswerInput,
  ): Promise<AIProviderResult<GroundedAnswerAIOutput>> {
    const context = AIInvocationContextSchema.parse(rawContext);
    const input = GroundedAnswerInputSchema.parse(rawInput);
    const result = await this.invoke({
      purpose: "generate_grounded_answer",
      context,
      input,
      schema: GroundedAnswerAIOutputSchema,
      inputImages: 0,
      postValidate: (output) => {
        const allowedClaims = new Set(
          input.facts.map(({ claimId }) => claimId),
        );
        if (
          output.segments.some(({ claimIds }) =>
            claimIds.some((claimId) => !allowedClaims.has(claimId)),
          )
        ) {
          throw new Error("Grounded answer cited a claim outside its input.");
        }
        if (
          output.mode === "clarification" &&
          output.clarificationQuestion !== input.allowedClarificationQuestion
        ) {
          throw new Error("Grounded answer invented a clarification question.");
        }
      },
    });
    return {
      ...result,
      data: canonicalizeGroundedAnswerText(result.data, input.facts),
    };
  }

  private async invoke<T>(
    invocation: Invocation<T>,
  ): Promise<AIProviderResult<T>> {
    const startedAt = Date.now();
    const modelRole = routeModelRole({
      purpose: invocation.purpose,
      allowStrongModel: invocation.context.allowStrongModel,
      complexity: invocation.complexity,
    });
    const model = this.models[modelRole];
    const failureRun = (
      status: Exclude<AIRunMetadata["status"], "success">,
      estimatedCostUsd = 0,
      promptTokens: number | null = null,
      completionTokens: number | null = null,
      retries = 0,
    ): AIRunMetadata => ({
      purpose: invocation.purpose,
      provider: "orcarouter-compatible",
      model: model.model,
      modelRole,
      promptVersion: this.promptVersion,
      schemaVersion: this.schemaVersion,
      inputAssets: invocation.inputImages,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - startedAt,
      retryCount: retries,
      estimatedCostUsd,
      status,
    });
    const rateDecision = await this.rateLimiter.consume(
      `${invocation.context.userId}:${invocation.purpose}`,
    );
    if (!rateDecision.allowed) {
      throw new AIProviderError(
        "rate_limited",
        rateDecision.reason === "store_unavailable"
          ? "AI rate limiter is unavailable; the request was denied."
          : "AI request rate limit reached.",
      ).withAuditRun(failureRun("rate_limited"));
    }
    let untrustedData: string;
    let outputJsonSchema: string;
    try {
      untrustedData = serializeUntrustedData(invocation.input);
      outputJsonSchema = JSON.stringify(z.toJSONSchema(invocation.schema));
    } catch (error) {
      throw new AIProviderError(
        "provider_error",
        "AI request data could not be serialized safely.",
        false,
        { cause: error },
      ).withAuditRun(failureRun("failed"));
    }
    const systemPrompt = systemPromptFor(
      invocation.purpose,
      this.schemaVersion,
      outputJsonSchema,
    );
    const estimatedInputTokens = Math.max(
      1,
      Math.ceil((untrustedData.length + systemPrompt.length) / 3) + 100,
    );
    const maximumAttemptCost = estimateAIRequestCost({
      model,
      estimatedInputTokens,
      inputImages: invocation.inputImages,
    });
    const maximumCost = maximumAttemptCost * (this.maxRetries + 1);
    let reservation: Awaited<ReturnType<AICostGuard["reserve"]>>;
    try {
      reservation = await this.costGuard.reserve(
        invocation.context.userId,
        invocation.purpose,
        maximumCost,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error.withAuditRun(failureRun(statusForError(error)));
      }
      throw new AIProviderError(
        "cost_limit",
        "AI cost reservation failed closed.",
        false,
        { cause: error },
      ).withAuditRun(failureRun("failed"));
    }

    let attemptsStarted = 0;
    let retryCount = 0;
    let accumulatedCost = 0;
    let observedPromptTokens: number | null = null;
    let observedCompletionTokens: number | null = null;
    try {
      const body = this.requestBody(
        invocation.purpose,
        modelRole,
        model,
        systemPrompt,
        untrustedData,
        invocation.imageParts ?? [],
      );
      let output: T | undefined;
      while (output === undefined) {
        if (attemptsStarted > 0) {
          const retryRateDecision = await this.rateLimiter.consume(
            `${invocation.context.userId}:${invocation.purpose}`,
          );
          if (!retryRateDecision.allowed) {
            throw new AIProviderError(
              "rate_limited",
              retryRateDecision.reason === "store_unavailable"
                ? "AI rate limiter is unavailable; the retry was denied."
                : "AI request rate limit reached before retry.",
            );
          }
        }
        attemptsStarted += 1;
        retryCount = attemptsStarted - 1;
        try {
          const { response, responseText } = await this.fetchAndRead(body);
          if (!response.ok) {
            throw mapHttpError(response.status);
          }

          let completionEnvelope: z.infer<typeof CompletionEnvelopeSchema>;
          try {
            completionEnvelope = CompletionEnvelopeSchema.parse(
              JSON.parse(responseText),
            );
          } catch (error) {
            throw new AIProviderError(
              "invalid_output",
              "AI provider returned an invalid completion envelope.",
              false,
              { cause: error },
            );
          }

          try {
            const rawContent: unknown = JSON.parse(
              completionEnvelope.choices[0]!.message.content,
            );
            output = invocation.schema.parse(rawContent);
            invocation.postValidate?.(output);
          } catch (error) {
            throw new AIProviderError(
              "invalid_output",
              "AI structured output failed validation.",
              false,
              { cause: error },
            );
          }

          const promptTokens = completionEnvelope.usage?.prompt_tokens ?? null;
          const completionTokens =
            completionEnvelope.usage?.completion_tokens ?? null;
          observedPromptTokens = addOptionalTokens(
            observedPromptTokens,
            promptTokens,
          );
          observedCompletionTokens = addOptionalTokens(
            observedCompletionTokens,
            completionTokens,
          );
          accumulatedCost += estimateAIActualCost({
            model,
            promptTokens,
            completionTokens,
            fallbackReservedUsd: maximumAttemptCost,
            inputImages: invocation.inputImages,
          });
        } catch (rawError) {
          const error = normalizeProviderError(rawError);
          accumulatedCost += maximumAttemptCost;
          if (error.retryable && retryCount < this.maxRetries) {
            continue;
          }
          throw error;
        }
      }
      const actualCost = Math.min(reservation.reservedUsd, accumulatedCost);
      await reservation.commit(actualCost);

      return {
        data: output,
        run: {
          purpose: invocation.purpose,
          provider: "orcarouter-compatible",
          model: model.model,
          modelRole,
          promptVersion: this.promptVersion,
          schemaVersion: this.schemaVersion,
          inputAssets: invocation.inputImages,
          promptTokens: observedPromptTokens,
          completionTokens: observedCompletionTokens,
          latencyMs: Date.now() - startedAt,
          retryCount,
          estimatedCostUsd: actualCost,
          status: "success",
        },
      };
    } catch (error) {
      const failedCost = Math.min(
        reservation.reservedUsd,
        Math.max(accumulatedCost, attemptsStarted * maximumAttemptCost),
      );
      if (attemptsStarted > 0) {
        await reservation.commit(failedCost).catch(() => undefined);
      } else {
        await reservation.release().catch(() => undefined);
      }
      if (error instanceof AIProviderError) {
        throw error.withAuditRun(
          failureRun(
            statusForError(error),
            failedCost,
            observedPromptTokens,
            observedCompletionTokens,
            retryCount,
          ),
        );
      }
      if (isAbortError(error)) {
        throw new AIProviderError(
          "timeout",
          "AI provider request timed out.",
          true,
          {
            cause: error,
          },
        ).withAuditRun(
          failureRun("timeout", failedCost, null, null, retryCount),
        );
      }
      throw new AIProviderError(
        "provider_error",
        "AI provider request failed.",
        true,
        {
          cause: error,
        },
      ).withAuditRun(failureRun("failed", failedCost, null, null, retryCount));
    }
  }

  private requestBody(
    purpose: AIPurpose,
    _modelRole: AIModelRole,
    model: AIModelConfig,
    systemPrompt: string,
    untrustedData: string,
    imageParts: Array<{
      mimeType: "image/jpeg" | "image/webp";
      base64: string;
    }>,
  ): string {
    const userContent =
      imageParts.length === 0
        ? untrustedData
        : [
            { type: "text", text: untrustedData },
            ...imageParts.map(({ mimeType, base64 }) => ({
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: "low",
              },
            })),
          ];

    return JSON.stringify({
      model: model.model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: model.maxOutputTokens,
    });
  }

  private async fetchAndRead(
    body: string,
  ): Promise<{ response: Response; responseText: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const responseText = await readBoundedResponse(
        response,
        this.maxResponseBytes,
      );
      return { response, responseText };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function completionEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch (error) {
    throw new AIProviderError(
      "configuration_error",
      "Invalid AI base URL.",
      false,
      {
        cause: error,
      },
    );
  }
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new AIProviderError(
      "configuration_error",
      "AI base URL must use HTTPS (except localhost tests).",
    );
  }
  return new URL("chat/completions", url);
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AIProviderError(
      "invalid_output",
      "AI response exceeded its size limit.",
    );
  }
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    receivedBytes += result.value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AIProviderError(
        "invalid_output",
        "AI response exceeded its size limit.",
      );
    }
    chunks.push(result.value);
  }

  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch (error) {
    throw new AIProviderError(
      "invalid_output",
      "AI response was not valid UTF-8.",
      false,
      { cause: error },
    );
  }
}

function mapHttpError(status: number): AIProviderError {
  if (status === 429) {
    return new AIProviderError(
      "rate_limited",
      "AI provider rate limit reached.",
      true,
    );
  }
  return new AIProviderError(
    "provider_error",
    `AI provider returned HTTP ${status}.`,
    status >= 500,
  );
}

function normalizeProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (isAbortError(error)) {
    return new AIProviderError(
      "timeout",
      "AI provider request timed out.",
      true,
      { cause: error },
    );
  }
  return new AIProviderError(
    "provider_error",
    "AI provider request failed.",
    true,
    { cause: error },
  );
}

function statusForError(
  error: AIProviderError,
): Exclude<AIRunMetadata["status"], "success"> {
  switch (error.code) {
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "invalid_output":
      return "invalid_output";
    case "configuration_error":
    case "cost_limit":
    case "provider_error":
      return "failed";
  }
}

function addOptionalTokens(
  total: number | null,
  current: number | null,
): number | null {
  if (current === null) return total;
  return (total ?? 0) + current;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new AIProviderError(
      "configuration_error",
      "The AI provider is server-only.",
    );
  }
}
