import { NextRequest } from "next/server";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { processAnalysisJobs } from "@/src/server/services/analysis-jobs";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const { user } = await requireAuthenticatedUser();
    const summary = await processAnalysisJobs({
      database: createSupabaseAdminClient(),
      requestId: id,
      userId: user.id,
      maxJobs: 1,
    });
    return dataResponse(summary);
  } catch (error) {
    return routeError(error, id);
  }
}
