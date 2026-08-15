import { NextRequest } from "next/server";
import { z } from "zod";

import { requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { getMemoryDetail } from "@/src/server/services/memories";
import { resolveRequestAuth } from "@/src/server/supabase/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = requestId(request);
  try {
    const memoryId = z.uuid().parse((await context.params).id);
    const { user, supabase } = await resolveRequestAuth(request);
    const detail = await getMemoryDetail(supabase, user.id, memoryId);
    return detail === null
      ? errorResponse(404, "MEMORY_NOT_FOUND", "Memoryが見つかりません。", id)
      : dataResponse(detail);
  } catch (error) {
    return routeError(error, id);
  }
}
