import { timingSafeEqual } from "node:crypto";

import { NextRequest } from "next/server";

import { dataResponse, errorResponse } from "@/src/server/http/responses";
import { processAnalysisJobs } from "@/src/server/services/analysis-jobs";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret.length < 20) {
    return errorResponse(
      503,
      "WORKER_NOT_CONFIGURED",
      "解析workerが設定されていません。",
    );
  }
  if (!hasBearerSecret(request, secret)) {
    return errorResponse(401, "WORKER_AUTH_REQUIRED", "認証が必要です。");
  }

  try {
    const summary = await processAnalysisJobs({
      database: createSupabaseAdminClient(),
      requestId: crypto.randomUUID(),
      maxJobs: 1,
    });
    return dataResponse(summary);
  } catch (error) {
    console.error("analysis_worker_failure", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      500,
      "WORKER_FAILED",
      "解析jobを完了できませんでした。",
    );
  }
}

function hasBearerSecret(request: NextRequest, expected: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const actual = authorization.slice("Bearer ".length);
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
