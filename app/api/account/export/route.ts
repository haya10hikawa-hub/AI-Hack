import { NextRequest } from "next/server";

import { requestId } from "@/src/server/http/security";
import { routeError } from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

type Database = ReturnType<typeof createSupabaseAdminClient>;

const userTables = [
  "media_assets",
  "media_sequences",
  "sequence_assets",
  "events",
  "evidence",
  "memories",
  "claims",
  "user_corrections",
  "claim_evidence",
  "memory_context_dimensions",
  "memory_gaps",
  "memory_relations",
  "personal_context",
  "search_feedback",
] as const;

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const { user } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    const [profile, preferences] = await Promise.all([
      database.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      database
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (profile.error !== null || preferences.error !== null) {
      throw new RepositoryError("export_account_profile");
    }

    const records: Record<string, unknown[]> = {};
    for (const table of userTables) {
      records[table] = await allUserRows(database, table, user.id);
    }

    const mediaAssets = records.media_assets ?? [];
    const storageKeys = mediaAssets.flatMap((value) => {
      if (value === null || typeof value !== "object") return [];
      const asset = value as Record<string, unknown>;
      return [asset.storage_key, asset.derivative_storage_key].filter(
        (key): key is string => typeof key === "string" && key.length > 0,
      );
    });
    const mediaDownloads: Array<{
      path: string | null;
      signedUrl: string;
      expiresInSeconds: number;
    }> = [];
    for (let index = 0; index < storageKeys.length; index += 100) {
      const signed = await database.storage
        .from("rememory-private")
        .createSignedUrls(storageKeys.slice(index, index + 100), 60 * 60);
      if (signed.error !== null)
        throw new RepositoryError("export_media_links");
      mediaDownloads.push(
        ...(signed.data ?? []).flatMap((item) =>
          item.signedUrl === null
            ? []
            : [
                {
                  path: item.path,
                  signedUrl: item.signedUrl,
                  expiresInSeconds: 3600,
                },
              ],
        ),
      );
    }

    const archive = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email ?? null,
        profile: profile.data,
        preferences: preferences.data,
      },
      records,
      mediaDownloads,
      note: "mediaDownloadsのURLは1時間だけ有効です。JSONと必要な元画像をその時間内に保存してください。",
    };
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(archive, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="rememory-export-${date}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return routeError(error, id);
  }
}

async function allUserRows(
  database: Database,
  table: (typeof userTables)[number],
  userId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await database
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .range(from, from + pageSize - 1);
    if (result.error !== null) {
      throw new RepositoryError(`export_${table}`);
    }
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
}
