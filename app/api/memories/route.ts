import { NextRequest } from "next/server";

import { requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { getMemoryThread } from "@/src/server/services/memories";
import { resolveRequestAuth } from "@/src/server/supabase/auth";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const { user, supabase } = await resolveRequestAuth(request);
    return dataResponse(await getMemoryThread(supabase, user.id));
  } catch (error) {
    return routeError(error, id);
  }
}
