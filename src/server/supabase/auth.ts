import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/src/server/supabase/client";

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function requireAuthenticatedUser(): Promise<{
  user: User;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) {
    throw new AuthenticationError();
  }
  return { user: data.user, supabase };
}
