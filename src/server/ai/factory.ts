import "server-only";

import { z } from "zod";

import {
  FixedWindowRateLimiter,
  type RateLimitStore,
} from "../security/rate-limit";
import { AICostGuard, type AICostLedger } from "./cost-guard";
import type { AIModelRole } from "./provider";
import { OrcaRouterProvider } from "./orca-router";

type Environment = Record<string, string | undefined>;

export interface AIProviderFactoryDependencies {
  rateLimitStore: RateLimitStore;
  costLedger: AICostLedger;
  fetchImplementation?: typeof fetch;
}

const EnvironmentSchema = z
  .object({
    AI_API_BASE_URL: z.url(),
    AI_API_KEY: z.string().trim().min(8),
    AI_MODEL_VISION_CHEAP: z.string().trim().min(1),
    AI_MODEL_EVENT_CHEAP: z.string().trim().min(1),
    AI_MODEL_CHAT_CHEAP: z.string().trim().min(1),
    AI_MODEL_EVENT_STRONG: z.string().trim().min(1),
    AI_MAX_COST_USD_PER_USER_DAY: z.coerce.number().positive().max(100),
    AI_MAX_COST_USD_PER_REQUEST: z.coerce.number().positive().max(10),
    AI_MAX_REQUESTS_PER_USER_MINUTE: z.coerce
      .number()
      .int()
      .positive()
      .max(10_000),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(1),
    AI_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1_024).max(5_000_000),
  })
  .passthrough();

const CONSERVATIVE_DEFAULT_PRICING = {
  inputUsdPerMillionTokens: 20,
  outputUsdPerMillionTokens: 60,
  imageUsdEach: 0.05,
} as const;

export function createAIProviderFromEnv(
  dependencies: AIProviderFactoryDependencies,
  environment: Environment = process.env,
): OrcaRouterProvider {
  const parsed = EnvironmentSchema.parse({
    ...environment,
    AI_MAX_COST_USD_PER_USER_DAY:
      environment.AI_MAX_COST_USD_PER_USER_DAY ?? "2.50",
    AI_MAX_COST_USD_PER_REQUEST:
      environment.AI_MAX_COST_USD_PER_REQUEST ?? "0.75",
    AI_MAX_REQUESTS_PER_USER_MINUTE:
      environment.AI_MAX_REQUESTS_PER_USER_MINUTE ?? "12",
    AI_REQUEST_TIMEOUT_MS: environment.AI_REQUEST_TIMEOUT_MS ?? "30000",
    AI_MAX_RETRIES: environment.AI_MAX_RETRIES ?? "1",
    AI_MAX_RESPONSE_BYTES: environment.AI_MAX_RESPONSE_BYTES ?? "512000",
  });
  const rateLimiter = new FixedWindowRateLimiter(
    {
      namespace: "ai",
      limit: parsed.AI_MAX_REQUESTS_PER_USER_MINUTE,
      windowMs: 60_000,
    },
    dependencies.rateLimitStore,
  );
  const costGuard = new AICostGuard(
    {
      dailyLimitUsd: parsed.AI_MAX_COST_USD_PER_USER_DAY,
      perRequestLimitUsd: parsed.AI_MAX_COST_USD_PER_REQUEST,
    },
    dependencies.costLedger,
  );

  return new OrcaRouterProvider({
    apiKey: parsed.AI_API_KEY,
    baseUrl: parsed.AI_API_BASE_URL,
    models: {
      VISION_CHEAP: modelFromEnvironment(
        "VISION_CHEAP",
        parsed.AI_MODEL_VISION_CHEAP,
        2_000,
        environment,
      ),
      EVENT_CHEAP: modelFromEnvironment(
        "EVENT_CHEAP",
        parsed.AI_MODEL_EVENT_CHEAP,
        1_400,
        environment,
      ),
      CHAT_CHEAP: modelFromEnvironment(
        "CHAT_CHEAP",
        parsed.AI_MODEL_CHAT_CHEAP,
        1_200,
        environment,
      ),
      EVENT_STRONG: modelFromEnvironment(
        "EVENT_STRONG",
        parsed.AI_MODEL_EVENT_STRONG,
        2_400,
        environment,
      ),
    },
    rateLimiter,
    costGuard,
    fetchImplementation: dependencies.fetchImplementation,
    timeoutMs: parsed.AI_REQUEST_TIMEOUT_MS,
    maxRetries: parsed.AI_MAX_RETRIES,
    maxResponseBytes: parsed.AI_MAX_RESPONSE_BYTES,
  });
}

function modelFromEnvironment(
  role: AIModelRole,
  model: string,
  maxOutputTokens: number,
  environment: Environment,
) {
  const prefix = `AI_PRICE_${role}`;
  const baseUrl = environment[`AI_BASE_URL_${role}`];
  return {
    model,
    inputUsdPerMillionTokens: parseNonNegativePrice(
      environment[`${prefix}_INPUT_USD_PER_MILLION`],
      CONSERVATIVE_DEFAULT_PRICING.inputUsdPerMillionTokens,
    ),
    outputUsdPerMillionTokens: parseNonNegativePrice(
      environment[`${prefix}_OUTPUT_USD_PER_MILLION`],
      CONSERVATIVE_DEFAULT_PRICING.outputUsdPerMillionTokens,
    ),
    imageUsdEach: parseNonNegativePrice(
      environment[`${prefix}_IMAGE_USD_EACH`],
      CONSERVATIVE_DEFAULT_PRICING.imageUsdEach,
    ),
    maxOutputTokens,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

function parseNonNegativePrice(
  rawValue: string | undefined,
  conservativeDefault: number,
): number {
  return z.coerce
    .number()
    .nonnegative()
    .max(10_000)
    .parse(rawValue ?? conservativeDefault);
}
