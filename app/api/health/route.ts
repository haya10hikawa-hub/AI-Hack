import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/src/server/config";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const publicConfigReady = getRuntimeConfig() !== null;
  const aiConfigReady = [
    process.env.AI_API_BASE_URL,
    process.env.AI_API_KEY,
    process.env.AI_MODEL_VISION_CHEAP,
    process.env.AI_MODEL_EVENT_CHEAP,
    process.env.AI_MODEL_CHAT_CHEAP,
    process.env.AI_MODEL_EVENT_STRONG,
  ].every((value) => typeof value === "string" && value.length > 0);
  let databaseReady = false;
  try {
    const result = await createSupabaseAdminClient()
      .from("profiles")
      .select("id", { head: true, count: "exact" });
    databaseReady = result.error === null;
  } catch {
    databaseReady = false;
  }
  const ready = publicConfigReady && databaseReady && aiConfigReady;
  return NextResponse.json(
    {
      status: ready ? "ready" : "degraded",
      checks: {
        publicConfig: publicConfigReady,
        database: databaseReady,
        aiConfiguration: aiConfigReady,
      },
      checkedAt: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
