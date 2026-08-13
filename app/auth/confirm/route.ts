import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/src/server/supabase/client";

const OtpTypeSchema = z.enum([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = OtpTypeSchema.safeParse(url.searchParams.get("type"));
  let succeeded = false;

  if (code !== null) {
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    succeeded = exchanged.error === null;
  } else if (tokenHash !== null && otpType.success) {
    const verified = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType.data as EmailOtpType,
    });
    succeeded = verified.error === null;
  }

  const destination = new URL(succeeded ? "/home" : "/auth/login", url);
  if (!succeeded) destination.searchParams.set("confirmation", "failed");
  return NextResponse.redirect(destination);
}
