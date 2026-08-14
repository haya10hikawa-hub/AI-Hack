import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";

const RequestSchema = z.object({
  password: z
    .string()
    .min(12)
    .max(200)
    .regex(/[a-z]/u)
    .regex(/[A-Z]/u)
    .regex(/[0-9]/u),
});

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = RequestSchema.parse(await request.json());
    const { supabase } = await requireAuthenticatedUser();
    const updated = await supabase.auth.updateUser({
      password: input.password,
    });
    if (updated.error !== null) {
      return errorResponse(
        400,
        "PASSWORD_UPDATE_FAILED",
        "パスワードを更新できませんでした。再設定リンクを開き直してください。",
        id,
      );
    }
    return dataResponse({ updated: true });
  } catch (error) {
    return routeError(error, id);
  }
}
