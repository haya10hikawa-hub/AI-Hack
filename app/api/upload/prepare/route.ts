import { NextRequest } from "next/server";
import { z } from "zod";

import {
  requireRuntimeConfig,
  requireSupabaseAdminConfig,
} from "@/src/server/config";
import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { createUploadManifest } from "@/src/server/services/upload-staging";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const PrepareUploadSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(500),
            mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
            bytes: z
              .number()
              .int()
              .positive()
              .max(100 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const config = requireRuntimeConfig();
    const input = PrepareUploadSchema.parse(await request.json());
    if (input.files.length > config.upload.maxFiles) {
      return errorResponse(
        400,
        "TOO_MANY_FILES",
        `一度に追加できる写真は${config.upload.maxFiles}枚までです。`,
        id,
      );
    }
    if (
      input.files.some(({ bytes }) => bytes > config.upload.maxBytesPerFile)
    ) {
      return errorResponse(
        413,
        "FILE_TOO_LARGE",
        `1枚あたり${Math.floor(config.upload.maxBytesPerFile / 1024 / 1024)}MB以下の写真を選んでください。`,
        id,
      );
    }

    const { user } = await requireAuthenticatedUser();
    const adminConfig = requireSupabaseAdminConfig();
    const database = createSupabaseAdminClient();
    const { manifest, token } = createUploadManifest({
      userId: user.id,
      files: input.files,
      secret: adminConfig.supabaseSecretKey,
    });
    const uploads = await Promise.all(
      manifest.files.map(async (file, clientIndex) => {
        const signed = await database.storage
          .from("rememory-private")
          .createSignedUploadUrl(file.path, { upsert: false });
        if (signed.error !== null || signed.data.token.length === 0) {
          throw new Error("Staged upload URL creation failed.");
        }
        return {
          clientIndex,
          slotId: file.slotId,
          path: file.path,
          token: signed.data.token,
        };
      }),
    );

    return dataResponse({ manifest: token, uploads });
  } catch (error) {
    return routeError(error, id);
  }
}
