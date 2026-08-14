import { after, NextRequest } from "next/server";
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
import {
  enqueueSequenceAnalysisJobs,
  processAnalysisJobs,
} from "@/src/server/services/analysis-jobs";
import {
  UploadManifestError,
  verifyUploadManifest,
} from "@/src/server/services/upload-staging";
import { ingestUpload } from "@/src/server/services/upload";
import { resolveCoarseLocationLabel } from "@/src/server/services/reverse-geocode";
import { createPlaceProviderFromEnv } from "@/src/server/places/provider";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const CompleteUploadSchema = z
  .object({
    manifest: z.string().min(1).max(32_000),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).nullable(),
    timezone: z.string().max(100).optional(),
    coarsePlace: z.string().max(80).nullable().optional(),
    placeCandidateId: z.string().min(3).max(220).nullable().optional(),
  })
  .strict();

export const runtime = "nodejs";
// The request body is now only a small signed manifest, while validated image
// decoding still happens here. Fluid Compute supports five minutes on Hobby,
// so real multi-photo batches are not forced through the old 60 second cap.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = CompleteUploadSchema.parse(await request.json());
    const config = requireRuntimeConfig();
    const adminConfig = requireSupabaseAdminConfig();
    const { user } = await requireAuthenticatedUser();
    let manifest;
    try {
      manifest = verifyUploadManifest({
        token: input.manifest,
        expectedUserId: user.id,
        secret: adminConfig.supabaseSecretKey,
        maxFiles: config.upload.maxFiles,
        maxBytesPerFile: config.upload.maxBytesPerFile,
      });
    } catch (error) {
      if (error instanceof UploadManifestError) {
        return errorResponse(
          400,
          "UPLOAD_SESSION_INVALID",
          "アップロードの有効期限が切れました。写真を選び直してください。",
          id,
        );
      }
      throw error;
    }

    const database = createSupabaseAdminClient();
    const selectedPlace = await resolveOptionalPlace(input.placeCandidateId);
    const bucket = database.storage.from("rememory-private");
    const stagedFiles = manifest.files;
    const sources = stagedFiles.map((staged) => ({
      name: staged.name,
      stagedOriginalKey: staged.path,
      reservedAssetId: staged.assetId,
      uploadSlotId: staged.slotId,
      load: async () => {
        const downloaded = await bucket.download(staged.path);
        if (downloaded.error !== null) {
          throw new Error("Staged photo download failed.");
        }
        if (downloaded.data.size !== staged.bytes) {
          throw new Error("Staged photo size did not match.");
        }
        return new File([await downloaded.data.arrayBuffer()], staged.name, {
          type: staged.mimeType,
        });
      },
    }));

    const result = await ingestUpload({
      client: database,
      userId: user.id,
      files: sources,
      config,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      coarsePlace: selectedPlace?.displayName ?? null,
      selectedPlace,
      resolveCoarseLocation: (location) =>
        resolveCoarseLocationLabel({ database, location }),
    });
    const enqueuedJobs = await enqueueSequenceAnalysisJobs({
      database,
      userId: user.id,
      sequences: result.sequences,
    });
    if (enqueuedJobs > 0) {
      after(() =>
        processAnalysisJobs({
          database,
          requestId: id,
          userId: user.id,
          maxJobs: 1,
        }).catch(() => undefined),
      );
    }

    // Do not remove unreferenced staged originals here. The same signed
    // manifest can be completed concurrently, so an early cleanup could
    // delete an object while the other invocation is still persisting its DB
    // row. Expired unreferenced objects belong in a separate age-gated cleanup
    // job where active completion requests cannot race the deletion.

    return dataResponse({
      accepted: result.accepted,
      rejected: result.rejected,
      sequenceIds: result.sequenceIds,
      processingState: result.processingState,
      message: result.message,
      placeStatus:
        input.placeCandidateId == null
          ? "not_selected"
          : selectedPlace === null
            ? "unavailable"
            : "selected",
    });
  } catch (error) {
    return routeError(error, id);
  }
}

async function resolveOptionalPlace(candidateId: string | null | undefined) {
  if (!candidateId) return null;
  try {
    return await createPlaceProviderFromEnv().resolve(candidateId);
  } catch {
    // Place enrichment is optional. Provider failure or a forged candidate ID
    // must never discard an otherwise valid photo upload.
    return null;
  }
}
