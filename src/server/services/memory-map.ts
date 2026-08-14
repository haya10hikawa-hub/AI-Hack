import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  MEMORY_MAP_MAX_CELLS,
  MEMORY_MAP_STATES,
} from "@/src/domain/memory-map";

import { RepositoryError } from "./memories";

const CellRowSchema = z.object({
  cell_id: z.string(),
  state: z.enum(MEMORY_MAP_STATES),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  visit_count: z.number().int().nonnegative(),
  dwell_bucket: z.enum(["pass_through", "short", "medium", "long"]).nullable(),
  evidence_count: z.number().int().nonnegative(),
  memory_count: z.number().int().nonnegative(),
  coarse_place: z.string().nullable(),
});

const MemoryRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  updated_at: z.string(),
  event: z
    .union([
      z.object({ coarse_place: z.string().nullable() }),
      z.array(z.object({ coarse_place: z.string().nullable() })),
    ])
    .nullable(),
});

type Client = SupabaseClient;

function eventPlace(event: z.infer<typeof MemoryRowSchema>["event"]) {
  const value = Array.isArray(event) ? event[0] : event;
  return value?.coarse_place ?? null;
}

export async function getMemoryMap(client: Client, userId: string) {
  const [preferenceResult, cellResult, linkResult, memoryResult] =
    await Promise.all([
      client
        .from("user_preferences")
        .select("memory_map_enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("memory_map_cells")
        .select(
          "cell_id,state,first_seen_at,last_seen_at,visit_count,dwell_bucket,evidence_count,memory_count,coarse_place",
        )
        .eq("user_id", userId)
        .order("last_seen_at", { ascending: false })
        .limit(MEMORY_MAP_MAX_CELLS),
      client
        .from("memory_map_cell_memories")
        .select("cell_id,memory_id")
        .eq("user_id", userId),
      client
        .from("memories")
        .select("id,title,updated_at,event:events(coarse_place)")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(100),
    ]);

  if (
    preferenceResult.error !== null ||
    cellResult.error !== null ||
    linkResult.error !== null ||
    memoryResult.error !== null
  ) {
    throw new RepositoryError("load_memory_map");
  }

  const memories = (memoryResult.data ?? [])
    .map((row) => MemoryRowSchema.safeParse(row))
    .filter((result) => result.success)
    .map((result) => result.data);
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const linksByCell = new Map<string, string[]>();
  for (const link of linkResult.data ?? []) {
    if (
      typeof link.cell_id === "string" &&
      typeof link.memory_id === "string" &&
      memoryById.has(link.memory_id)
    ) {
      linksByCell.set(link.cell_id, [
        ...(linksByCell.get(link.cell_id) ?? []),
        link.memory_id,
      ]);
    }
  }

  const cells = (cellResult.data ?? [])
    .map((row) => CellRowSchema.safeParse(row))
    .filter((result) => result.success)
    .map(({ data: cell }) => ({
      cellId: cell.cell_id,
      state: cell.state,
      firstSeenAt: cell.first_seen_at,
      lastSeenAt: cell.last_seen_at,
      visitCount: cell.visit_count,
      dwellBucket: cell.dwell_bucket,
      evidenceCount: cell.evidence_count,
      memoryCount: cell.memory_count,
      coarsePlace: cell.coarse_place,
      memories: (linksByCell.get(cell.cell_id) ?? []).flatMap((memoryId) => {
        const memory = memoryById.get(memoryId);
        return memory
          ? [
              {
                id: memory.id,
                title: memory.title,
                updatedAt: memory.updated_at,
              },
            ]
          : [];
      }),
    }));

  const areaMap = new Map<
    string,
    { coarsePlace: string; memories: Array<{ id: string; title: string }> }
  >();
  for (const memory of memories) {
    const rawPlace = eventPlace(memory.event);
    if (!rawPlace) continue;
    const coarsePlace = rawPlace.startsWith("grid:")
      ? "位置情報を粗く保持した地域"
      : rawPlace;
    const area = areaMap.get(coarsePlace) ?? { coarsePlace, memories: [] };
    area.memories.push({ id: memory.id, title: memory.title });
    areaMap.set(coarsePlace, area);
  }

  return {
    enabled: preferenceResult.data?.memory_map_enabled === true,
    cells,
    coarseAreas: [...areaMap.values()],
    partial: cells.length >= MEMORY_MAP_MAX_CELLS,
    partialMessage:
      cells.length >= MEMORY_MAP_MAX_CELLS
        ? "最近ひらいた500地域を表示しています。Memoryの地域一覧は引き続き利用できます。"
        : null,
  };
}
