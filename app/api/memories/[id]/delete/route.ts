import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const memoryId = z.uuid().parse((await context.params).id);
    const { user } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    const owned = await database
      .from("memories")
      .select("id,status,event_id")
      .eq("id", memoryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (owned.error !== null)
      throw new RepositoryError("load_memory_for_deletion");
    if (owned.data === null) {
      // Forget/delete is intentionally idempotent. This also avoids disclosing
      // whether an arbitrary identifier belongs to another account.
      return dataResponse({ deleted: true, idempotent: true });
    }
    if (owned.data.status === "deleted") {
      return dataResponse({ deleted: true, idempotent: true });
    }

    const event = await database
      .from("events")
      .select("sequence_id")
      .eq("id", owned.data.event_id)
      .eq("user_id", user.id)
      .single();
    if (event.error !== null)
      throw new RepositoryError("load_event_for_deletion");
    const membership = await database
      .from("sequence_assets")
      .select("asset_id")
      .eq("user_id", user.id)
      .eq("sequence_id", event.data.sequence_id);
    if (membership.error !== null) {
      throw new RepositoryError("load_assets_for_deletion");
    }
    const assetIds = (membership.data ?? []).map(({ asset_id }) => asset_id);
    const assets =
      assetIds.length === 0
        ? { data: [], error: null }
        : await database
            .from("media_assets")
            .select("storage_key,derivative_storage_key")
            .eq("user_id", user.id)
            .in("id", assetIds);
    if (assets.error !== null)
      throw new RepositoryError("load_storage_for_deletion");

    if (owned.data.status !== "deleting") {
      const requested = await database.rpc("request_memory_deletion", {
        p_user_id: user.id,
        p_memory_id: memoryId,
      });
      if (requested.error !== null || requested.data !== true) {
        throw new RepositoryError("request_memory_deletion");
      }
    }

    const storageKeys = (assets.data ?? []).flatMap((asset) =>
      [asset.storage_key, asset.derivative_storage_key].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    );
    if (storageKeys.length > 0) {
      const removed = await database.storage
        .from("rememory-private")
        .remove(storageKeys);
      if (removed.error !== null) {
        // The row remains in `deleting`, so calling this endpoint again safely
        // retries only the unfinished storage/finalization work.
        throw new RepositoryError("remove_memory_storage");
      }
    }
    const finalized = await database.rpc("finalize_memory_deletion", {
      p_user_id: user.id,
      p_memory_id: memoryId,
    });
    if (finalized.error !== null) {
      throw new RepositoryError("finalize_memory_deletion");
    }
    if (finalized.data !== true) {
      const remaining = await database
        .from("memories")
        .select("id")
        .eq("id", memoryId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (remaining.error !== null || remaining.data !== null) {
        throw new RepositoryError("finalize_memory_deletion");
      }
      return dataResponse({ deleted: true, idempotent: true });
    }
    return dataResponse({
      deleted: true,
      message: "Memory、Evidence、派生画像と元画像を削除しました。",
    });
  } catch (error) {
    return routeError(error, id);
  }
}
