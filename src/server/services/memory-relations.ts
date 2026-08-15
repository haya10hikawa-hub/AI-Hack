import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MemoryRelationClaimSchema,
  RelationMemorySchema,
  deriveMemoryRelations,
  type RelationMemory,
} from "@/src/domain/memory-relations";

const MAX_RELATION_CANDIDATES = 25;

/** Replaces deterministic edges around one Memory from a bounded recent set. */
export async function refreshMemoryRelations(input: {
  client: SupabaseClient;
  userId: string;
  memoryId: string;
}): Promise<number> {
  const currentResult = await input.client
    .from("memories")
    .select("id,event:events(started_at,coarse_place)")
    .eq("user_id", input.userId)
    .eq("id", input.memoryId)
    .eq("status", "active")
    .maybeSingle();
  if (currentResult.error !== null || currentResult.data === null) {
    throw new Error("Relation source Memory is unavailable.");
  }
  const candidatesResult = await input.client
    .from("memories")
    .select("id,event:events(started_at,coarse_place)")
    .eq("user_id", input.userId)
    .eq("status", "active")
    .neq("id", input.memoryId)
    .order("updated_at", { ascending: false })
    .limit(MAX_RELATION_CANDIDATES);
  if (candidatesResult.error !== null) {
    throw new Error("Relation candidate loading failed.");
  }

  const rows = [currentResult.data, ...(candidatesResult.data ?? [])];
  const memoryIds = rows.map(({ id }) => id);
  const claimsResult = await input.client
    .from("claims")
    .select(
      "id,memory_id,field,value_json,origin,confidence_band,confirmation_status,status",
    )
    .eq("user_id", input.userId)
    .eq("field", "activity")
    .in("memory_id", memoryIds)
    .limit(200);
  if (claimsResult.error !== null) {
    throw new Error("Relation Claim loading failed.");
  }

  const claimsByMemory = new Map<string, RelationMemory["claims"]>();
  for (const claim of claimsResult.data ?? []) {
    const parsed = MemoryRelationClaimSchema.safeParse({
      id: claim.id,
      field: claim.field,
      value: claim.value_json,
      origin: claim.origin,
      confidenceBand: claim.confidence_band,
      confirmationStatus: claim.confirmation_status,
      status: claim.status,
    });
    if (!parsed.success) continue;
    claimsByMemory.set(claim.memory_id, [
      ...(claimsByMemory.get(claim.memory_id) ?? []),
      parsed.data,
    ]);
  }
  const memories = rows.map((row) =>
    RelationMemorySchema.parse({
      id: row.id,
      userId: input.userId,
      capturedAt: oneEvent(row.event)?.started_at ?? null,
      coarsePlace: oneEvent(row.event)?.coarse_place ?? null,
      claims: claimsByMemory.get(row.id) ?? [],
    }),
  );
  const current = memories[0]!;
  const relations = deriveMemoryRelations(current, memories.slice(1));
  const replaced = await input.client.rpc("replace_memory_relations", {
    p_user_id: input.userId,
    p_memory_id: input.memoryId,
    p_relations: relations,
  });
  if (replaced.error !== null || replaced.data !== relations.length) {
    throw new Error("Memory relation persistence failed.");
  }
  return relations.length;
}

function oneEvent(value: unknown): {
  started_at: string | null;
  coarse_place: string | null;
} | null {
  const event = Array.isArray(value) ? value[0] : value;
  if (event === null || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  return {
    started_at:
      typeof record.started_at === "string" ? record.started_at : null,
    coarse_place:
      typeof record.coarse_place === "string" ? record.coarse_place : null,
  };
}
