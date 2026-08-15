import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemoryRepresentative } from "@/src/domain/memory-distillation";

/** Atomically replaces the final semantic set; deterministic candidates stay intact. */
export async function persistMemoryRepresentatives(input: {
  client: SupabaseClient;
  userId: string;
  memoryId: string;
  aiRunId: string;
  representatives: readonly MemoryRepresentative[];
}): Promise<boolean> {
  if (input.representatives.length === 0) return false;
  const { data, error } = await input.client.rpc(
    "replace_memory_representatives",
    {
      p_user_id: input.userId,
      p_memory_id: input.memoryId,
      p_source_ai_run_id: input.aiRunId,
      p_representatives: input.representatives,
    },
  );
  if (error !== null || data !== true) {
    throw new Error("Memory representative persistence failed.");
  }
  return true;
}
