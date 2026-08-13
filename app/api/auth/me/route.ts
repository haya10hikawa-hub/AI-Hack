import { NextRequest } from "next/server";

import { requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const { user } = await requireAuthenticatedUser();
    return dataResponse({
      id: user.id,
      email: user.email ?? null,
      displayName:
        typeof user.user_metadata.display_name === "string"
          ? user.user_metadata.display_name
          : null,
    });
  } catch (error) {
    return routeError(error, id);
  }
}
