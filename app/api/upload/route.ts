import { after, NextRequest } from "next/server";
import { z } from "zod";

import { requireRuntimeConfig } from "@/src/server/config";
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
import { ingestUpload } from "@/src/server/services/upload";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const config = requireRuntimeConfig();
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    const maximumRequestBytes =
      config.upload.maxFiles * config.upload.maxBytesPerFile + 1_000_000;
    if (
      Number.isFinite(contentLength) &&
      contentLength > 0 &&
      contentLength > maximumRequestBytes
    ) {
      return errorResponse(
        413,
        "UPLOAD_TOO_LARGE",
        "アップロード全体のサイズが上限を超えています。",
        id,
      );
    }
    const { user } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) {
      return errorResponse(
        400,
        "FILES_REQUIRED",
        "写真を1枚以上選んでください。",
        id,
      );
    }
    const timezoneOffsetMinutes = parseTimezoneOffset(
      form.get("timezoneOffsetMinutes"),
    );
    const coarsePlace = parseCoarsePlace(form.get("coarsePlace"));
    const result = await ingestUpload({
      client: database,
      userId: user.id,
      files,
      config,
      timezoneOffsetMinutes,
      coarsePlace,
    });

    // Persist jobs before responding. `after` only reduces initial latency;
    // the cron worker can reclaim queued or expired work after a process exit.
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
          maxJobs: 1,
        }).catch(() => undefined),
      );
    }

    return dataResponse({
      accepted: result.accepted,
      rejected: result.rejected,
      sequenceIds: result.sequenceIds,
      processingState: result.processingState,
      message: result.message,
    });
  } catch (error) {
    return routeError(error, id);
  }
}

function parseTimezoneOffset(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^-?\d{1,4}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -840 && parsed <= 840
    ? parsed
    : null;
}

function parseCoarsePlace(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return null;
  return z
    .string()
    .max(80)
    .refine((text) => !/[<>\u0000-\u001f\u007f]/u.test(text))
    .parse(normalized);
}
