import { NextRequest } from "next/server";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { errorResponse, routeError } from "@/src/server/http/responses";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    return errorResponse(
      410,
      "AUTH_DISABLED",
      "このアプリはログインなしで利用できます。",
      id,
    );
  } catch (error) {
    return routeError(error, id);
  }
}
