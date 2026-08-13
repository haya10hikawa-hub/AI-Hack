import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  requireRuntimeConfig,
  requireSupabaseAdminConfig,
} from "@/src/server/config";

export async function createSupabaseServerClient() {
  const config = requireRuntimeConfig();
  const cookieStore = await cookies();

  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
          });
        } catch {
          // A read-only Server Component cannot mutate cookies. Route Handlers
          // and auth responses can, and are the only callers that rely on it.
        }
      },
    },
  });
}

/**
 * Server-only write client. The secret key never enters browser bundles or
 * cookies. Callers must derive every owner id from `auth.getUser()` and keep an
 * explicit `user_id` predicate on reads/writes because this client bypasses RLS.
 */
export function createSupabaseAdminClient() {
  const config = requireSupabaseAdminConfig();
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
