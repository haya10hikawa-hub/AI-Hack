import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { processAnalysisJobs } from "@/src/server/services/analysis-jobs";
import { RepositoryError } from "@/src/server/services/memories";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const RetryRequestSchema = z
  .object({ memoryId: z.string().uuid().optional() })
  .strict();

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = RetryRequestSchema.parse(await request.json());
    const { user } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    let retryableQuery = database
      .from("sequence_analysis_jobs")
      .select("sequence_id,memory_id")
      .eq("user_id", user.id)
      .in("status", ["dead", "retry_wait"])
      .limit(12);
    if (input.memoryId !== undefined) {
      retryableQuery = retryableQuery.eq("memory_id", input.memoryId);
    }
    const retryable = await retryableQuery;
    if (retryable.error !== null) {
      throw new RepositoryError("load_retryable_analysis_jobs");
    }

    for (const job of retryable.data) {
      const enqueued = await database.rpc("enqueue_sequence_analysis_job", {
        p_user_id: user.id,
        p_sequence_id: job.sequence_id,
        p_memory_id: job.memory_id,
      });
      if (enqueued.error !== null || typeof enqueued.data !== "string") {
        throw new RepositoryError("retry_analysis_job");
      }
    }

    const processing = await processAnalysisJobs({
      database,
      requestId: id,
      userId: user.id,
      maxJobs: 1,
    });
    return dataResponse({
      retryRequested: retryable.data.length,
      processing,
    });
  } catch (error) {
    return routeError(error, id);
  }
}
