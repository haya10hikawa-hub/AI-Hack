import "server-only";

import { z } from "zod";

const PositiveInt = z.coerce.number().int().positive();

const RuntimeConfigSchema = z.object({
  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().min(20),
  upload: z.object({
    maxFiles: PositiveInt.max(20),
    maxBytesPerFile: PositiveInt.max(100 * 1024 * 1024),
    maxPixels: PositiveInt.max(1_000_000_000),
    visionMaxEdge: PositiveInt.max(4096),
  }),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

const SupabaseAdminConfigSchema = z.object({
  supabaseUrl: z.url(),
  supabaseSecretKey: z.string().min(20),
});

export type SupabaseAdminConfig = z.infer<typeof SupabaseAdminConfigSchema>;

export function getRuntimeConfig(): RuntimeConfig | null {
  const parsed = RuntimeConfigSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    upload: {
      maxFiles: process.env.UPLOAD_MAX_FILES ?? 12,
      maxBytesPerFile:
        process.env.UPLOAD_MAX_BYTES_PER_FILE ?? 15 * 1024 * 1024,
      maxPixels: process.env.UPLOAD_MAX_PIXELS ?? 40_000_000,
      visionMaxEdge: process.env.VISION_MAX_EDGE ?? 1600,
    },
  });
  return parsed.success ? parsed.data : null;
}

export function requireRuntimeConfig(): RuntimeConfig {
  const config = getRuntimeConfig();
  if (config === null) {
    throw new ConfigurationError(
      "Supabase is not configured. Set the public project URL and publishable key.",
    );
  }
  return config;
}

export function requireSupabaseAdminConfig(): SupabaseAdminConfig {
  const parsed = SupabaseAdminConfigSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseSecretKey:
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) {
    throw new ConfigurationError(
      "Supabase server writes are not configured. Set SUPABASE_SECRET_KEY.",
    );
  }
  return parsed.data;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
