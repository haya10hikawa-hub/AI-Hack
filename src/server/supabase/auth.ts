import "server-only";

import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/src/server/supabase/client";

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

const PUBLIC_PREVIEW_COOKIE = "rememory_public_preview_user";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function clearPublicPreviewUserCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(PUBLIC_PREVIEW_COOKIE);
}

export async function requireAuthenticatedUser(): Promise<{
  user: User;
  supabase:
    | Awaited<ReturnType<typeof createSupabaseServerClient>>
    | ReturnType<typeof createSupabaseAdminClient>;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error === null && data.user !== null) return { user: data.user, supabase };
  return createPublicPreviewUser();
}

async function createPublicPreviewUser(): Promise<{
  user: User;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
}> {
  const cookieStore = await cookies();
  const admin = createSupabaseAdminClient();
  const existingId = cookieStore.get(PUBLIC_PREVIEW_COOKIE)?.value;
  if (existingId && uuidPattern.test(existingId)) {
    const existing = await admin.auth.admin.getUserById(existingId);
    if (existing.error === null && existing.data.user !== null) {
      await ensurePublicPreviewProfile(admin, existing.data.user.id);
      return { user: existing.data.user, supabase: admin };
    }
  }

  const nonce = crypto.randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `public-preview-${nonce}@rememory.invalid`,
    password: `${crypto.randomUUID()}Aa1!`,
    email_confirm: true,
    user_metadata: {
      display_name: "Public Preview",
      rememory_public_preview: true,
    },
  });
  if (created.error !== null || created.data.user === null) {
    throw new AuthenticationError("Public preview user could not be created.");
  }
  await ensurePublicPreviewProfile(admin, created.data.user.id);
  cookieStore.set(PUBLIC_PREVIEW_COOKIE, created.data.user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { user: created.data.user, supabase: admin };
}

async function ensurePublicPreviewProfile(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
) {
  const profile = await supabase
    .from("profiles")
    .upsert(
      { id: userId, display_name: "Public Preview" },
      { onConflict: "id" },
    );
  if (profile.error !== null) {
    throw new AuthenticationError("Public preview profile could not be saved.");
  }
  const preferences = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId }, { onConflict: "user_id" });
  if (preferences.error !== null) {
    throw new AuthenticationError(
      "Public preview preferences could not be saved.",
    );
  }
}
