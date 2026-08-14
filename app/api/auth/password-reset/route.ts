import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { createSupabaseServerClient } from "@/src/server/supabase/client";

const RequestSchema = z.object({ email: z.email().max(254) });

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const { email } = RequestSchema.parse(await request.json());
    const origin = process.env.APP_ORIGIN ?? new URL(request.url).origin;
    const supabase = await createSupabaseServerClient();
    // Always return the same result so this endpoint cannot enumerate users.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=/auth/update-password`,
    });
    return dataResponse({
      sent: true,
      message:
        "登録済みの場合は再設定メールを送信しました。メール内のリンクを開いてください。",
    });
  } catch (error) {
    return routeError(error, id);
  }
}
