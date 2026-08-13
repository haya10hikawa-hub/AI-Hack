import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AIProviderError, type AIRunMetadata } from "@/src/server/ai/provider";

export async function persistAIRun(
  supabase: SupabaseClient,
  userId: string,
  run: AIRunMetadata,
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("ai_runs").insert({
    id,
    user_id: userId,
    purpose: run.purpose,
    model: run.model,
    provider: run.provider,
    prompt_version: run.promptVersion,
    schema_version: run.schemaVersion,
    input_assets: run.inputAssets,
    prompt_tokens: run.promptTokens,
    completion_tokens: run.completionTokens,
    cost_usd_estimate: run.estimatedCostUsd,
    latency_ms: run.latencyMs,
    retry_count: run.retryCount,
    status: run.status,
  });
  if (error !== null) throw new Error("AI run audit persistence failed.");
  return id;
}

/** Persists a content-free failed run if the provider reached routing. */
export async function persistAIProviderFailure(
  supabase: SupabaseClient,
  userId: string,
  error: unknown,
): Promise<string | null> {
  if (!(error instanceof AIProviderError) || error.auditRun === null) {
    return null;
  }
  return persistAIRun(supabase, userId, error.auditRun);
}
