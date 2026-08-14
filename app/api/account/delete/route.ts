import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const DeleteSchema = z.object({ confirmation: z.literal("削除") });

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const parsed = DeleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        "DELETE_CONFIRMATION_REQUIRED",
        "確認欄に「削除」と入力してください。",
        id,
      );
    }
    const { user, supabase } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    const assets = await database
      .from("media_assets")
      .select("storage_key,derivative_storage_key")
      .eq("user_id", user.id);
    if (assets.error !== null)
      throw new RepositoryError("load_account_storage");
    const storageKeys = (assets.data ?? []).flatMap((asset) =>
      [asset.storage_key, asset.derivative_storage_key].filter(
        (key): key is string => typeof key === "string" && key.length > 0,
      ),
    );
    for (let index = 0; index < storageKeys.length; index += 100) {
      const removed = await database.storage
        .from("rememory-private")
        .remove(storageKeys.slice(index, index + 100));
      if (removed.error !== null)
        throw new RepositoryError("remove_account_storage");
    }

    const deleted = await database.auth.admin.deleteUser(user.id);
    if (deleted.error !== null)
      throw new RepositoryError("delete_auth_account");
    // Clearing the browser session is best-effort after Auth has deleted the user.
    await supabase.auth.signOut().catch(() => undefined);
    return dataResponse({
      deleted: true,
      message: "アカウント、Memory、Evidence、写真を削除しました。",
    });
  } catch (error) {
    return routeError(error, id);
  }
}
