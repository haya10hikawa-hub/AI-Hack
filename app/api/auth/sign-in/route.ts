import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { createSupabaseServerClient } from "@/src/server/supabase/client";

const SignInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = SignInSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(input);
    if (error !== null || data.user === null) {
      return errorResponse(
        401,
        "INVALID_CREDENTIALS",
        "メールアドレスまたはパスワードを確認してください。",
        id,
      );
    }
    return dataResponse({ userId: data.user.id, authenticated: true });
  } catch (error) {
    return routeError(error, id);
  }
}
