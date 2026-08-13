import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { createSupabaseServerClient } from "@/src/server/supabase/client";

const SignUpSchema = z.object({
  email: z.email().max(254),
  password: z
    .string()
    .min(12)
    .max(200)
    .regex(/[a-z]/u)
    .regex(/[A-Z]/u)
    .regex(/[0-9]/u),
  displayName: z.string().trim().min(1).max(80),
});

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = SignUpSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const confirmationOrigin =
      process.env.APP_ORIGIN ?? new URL(request.url).origin;
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { display_name: input.displayName },
        emailRedirectTo: `${confirmationOrigin}/auth/confirm`,
      },
    });
    if (error !== null) {
      return errorResponse(
        400,
        "SIGN_UP_FAILED",
        "アカウントを作成できませんでした。入力内容を確認してください。",
        id,
      );
    }
    return dataResponse(
      {
        userId: data.user?.id ?? null,
        authenticated: data.session !== null,
        emailConfirmationRequired: data.session === null,
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, id);
  }
}
