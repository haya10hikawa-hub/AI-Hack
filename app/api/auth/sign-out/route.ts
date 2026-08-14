import { NextRequest } from "next/server";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import {
  clearPublicPreviewUserCookie,
  requireAuthenticatedUser,
} from "@/src/server/supabase/auth";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const { supabase } = await requireAuthenticatedUser();
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    await clearPublicPreviewUserCookie();
    return dataResponse({ authenticated: false });
  } catch (error) {
    return routeError(error, id);
  }
}
