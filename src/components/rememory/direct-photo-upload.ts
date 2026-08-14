"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function storageClient(): SupabaseClient {
  if (client !== null) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("写真保存サービスが設定されていません。");
  }
  client = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return client;
}

export async function uploadPhotoToSignedSlot(input: {
  path: string;
  token: string;
  file: File;
}): Promise<void> {
  const result = await storageClient()
    .storage.from("rememory-private")
    .uploadToSignedUrl(input.path, input.token, input.file, {
      cacheControl: "0",
      contentType: input.file.type,
      upsert: false,
    });
  if (result.error !== null) {
    throw new Error("写真を保存先へ送信できませんでした。");
  }
}
