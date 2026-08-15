import { NextRequest } from "next/server";
import { z } from "zod";

import { isAllowedMemoryMapCell } from "@/src/domain/memory-map";
import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { getMemoryMap } from "@/src/server/services/memory-map";
import { RepositoryError } from "@/src/server/services/memories";
import {
  requireAuthenticatedUser,
  resolveRequestAuth,
} from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const RevealSchema = z
  .object({ cellId: z.string().trim().refine(isAllowedMemoryMapCell) })
  .strict();

function bodyIsBounded(request: NextRequest): boolean {
  const length = Number(request.headers.get("content-length") ?? "0");
  return Number.isFinite(length) && length <= 1024;
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const { user, supabase } = await resolveRequestAuth(request);
    return dataResponse(await getMemoryMap(supabase, user.id));
  } catch (error) {
    return routeError(error, id);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    if (!bodyIsBounded(request)) {
      return errorResponse(
        413,
        "REQUEST_TOO_LARGE",
        "リクエストが大きすぎます。",
        id,
      );
    }
    const rawBody = await request.text();
    if (rawBody.length > 1024) {
      return errorResponse(
        413,
        "REQUEST_TOO_LARGE",
        "リクエストが大きすぎます。",
        id,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "JSON形式が正しくありません。",
        id,
      );
    }
    const parsed = RevealSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "有効なH3セルIDが必要です。",
        id,
      );
    }
    const input = parsed.data;
    const { user } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    const preference = await database
      .from("user_preferences")
      .select("memory_map_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (preference.error !== null)
      throw new RepositoryError("load_map_preference");
    if (preference.data?.memory_map_enabled !== true) {
      return errorResponse(
        409,
        "MEMORY_MAP_DISABLED",
        "Memory Mapを有効にしてから現在地を使ってください。",
        id,
      );
    }
    const revealed = await database.rpc("reveal_memory_map_cell", {
      p_user_id: user.id,
      p_cell_id: input.cellId,
    });
    if (revealed.error !== null)
      throw new RepositoryError("reveal_memory_map_cell");
    return dataResponse({ revealed: true, cellId: input.cellId });
  } catch (error) {
    return routeError(error, id);
  }
}

export async function DELETE(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const { user } = await requireAuthenticatedUser();
    const removed = await createSupabaseAdminClient()
      .from("memory_map_cells")
      .delete()
      .eq("user_id", user.id);
    if (removed.error !== null) throw new RepositoryError("clear_memory_map");
    return dataResponse({ cleared: true });
  } catch (error) {
    return routeError(error, id);
  }
}
