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
 * Read/write client bound to a native client's access token. Row Level Security
 * applies exactly as it does for the cookie session, so a bearer caller reaches
 * only its own rows. The token lives in this client's request headers and is
 * never persisted, cached, or logged.
 */
export function createSupabaseBearerClient(accessToken: string) {
  const config = requireRuntimeConfig();
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
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
