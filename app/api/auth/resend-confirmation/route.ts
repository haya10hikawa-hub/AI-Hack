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
    // Do not expose whether the address is registered or already confirmed.
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm` },
    });
    return dataResponse({
      sent: true,
      message:
        "確認が必要な場合はメールを再送しました。受信箱と迷惑メールを確認してください。",
    });
  } catch (error) {
    return routeError(error, id);
  }
}
