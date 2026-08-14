import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { persistAIProviderFailure } from "@/src/server/ai";
import { AIProviderError } from "@/src/server/ai/provider";
import {
  analyzePersistedSequence,
  type AnalysisPipelineStage,
  type AnalysisRepresentativeAsset,
} from "@/src/server/services/analysis-pipeline";

const JOB_LEASE_SECONDS = 300;

interface SequenceJobInput {
  sequenceId: string;
  memoryId: string;
  representativeAssets: Array<{ id: string }>;
}

interface ClaimedJob {
  jobId: string;
  userId: string;
  sequenceId: string;
  memoryId: string;
  attemptCount: number;
  stage: AnalysisPipelineStage;
}

export interface AnalysisJobRunSummary {
  claimed: number;
  completed: number;
  retryScheduled: number;
  dead: number;
}

export async function enqueueSequenceAnalysisJobs(input: {
  database: SupabaseClient;
  userId: string;
  sequences: SequenceJobInput[];
}): Promise<number> {
  let enqueued = 0;
  for (const sequence of input.sequences) {
    if (sequence.representativeAssets.length === 0) continue;
    const result = await input.database.rpc("enqueue_sequence_analysis_job", {
      p_user_id: input.userId,
      p_sequence_id: sequence.sequenceId,
      p_memory_id: sequence.memoryId,
    });
    if (result.error !== null || typeof result.data !== "string") {
      throw new Error("Sequence analysis job enqueue failed.");
    }
    enqueued += 1;
  }
  return enqueued;
}

export async function processAnalysisJobs(input: {
  database: SupabaseClient;
  requestId: string;
  maxJobs?: number;
  userId?: string;
}): Promise<AnalysisJobRunSummary> {
  const summary: AnalysisJobRunSummary = {
    claimed: 0,
    completed: 0,
    retryScheduled: 0,
    dead: 0,
  };
  const maxJobs = Math.max(1, Math.min(4, input.maxJobs ?? 1));
  const workerId = crypto.randomUUID();

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextJob(input.database, workerId, input.userId);
    if (job === null) break;
    summary.claimed += 1;
    const outcome = await processClaimedJob({
      ...input,
      workerId,
      job,
    });
    if (outcome === "complete") summary.completed += 1;
    if (outcome === "retry_wait") summary.retryScheduled += 1;
    if (outcome === "dead") summary.dead += 1;
  }
  return summary;
}

async function claimNextJob(
  database: SupabaseClient,
  workerId: string,
  userId: string | undefined,
): Promise<ClaimedJob | null> {
  const result = await database.rpc("claim_sequence_analysis_job", {
    p_worker_id: workerId,
    p_lease_seconds: JOB_LEASE_SECONDS,
    p_user_id: userId ?? null,
  });
  if (result.error !== null) {
    throw new Error("Sequence analysis job claim failed.");
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (row === undefined || row === null) return null;
  if (
    typeof row.job_id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.sequence_id !== "string" ||
    typeof row.memory_id !== "string" ||
    typeof row.attempt_count !== "number"
  ) {
    throw new Error("Sequence analysis job claim was invalid.");
  }
  const checkpoint = await database
    .from("sequence_analysis_jobs")
    .select("stage")
    .eq("id", row.job_id)
    .eq("user_id", row.user_id)
    .single();
  if (checkpoint.error !== null || !isPipelineStage(checkpoint.data.stage)) {
    throw new Error("Sequence analysis job checkpoint was invalid.");
  }
  return {
    jobId: row.job_id,
    userId: row.user_id,
    sequenceId: row.sequence_id,
    memoryId: row.memory_id,
    attemptCount: row.attempt_count,
    stage: checkpoint.data.stage,
  };
}

async function processClaimedJob(input: {
  database: SupabaseClient;
  requestId: string;
  workerId: string;
  job: ClaimedJob;
}): Promise<"complete" | "retry_wait" | "dead"> {
  try {
    const representativeAssets =
      input.job.stage === "analysis"
        ? await loadRepresentativeAssets(input.database, input.job)
        : [];
    await analyzePersistedSequence({
      userId: input.job.userId,
      requestId: input.requestId,
      sequenceId: input.job.sequenceId,
      memoryId: input.job.memoryId,
      representativeAssets,
      database: input.database,
      resumeFrom: input.job.stage,
      onStage: async (stage) => {
        await touchJob(input.database, input.job.jobId, input.workerId, stage);
      },
    });
    return await finishJob(input.database, {
      jobId: input.job.jobId,
      workerId: input.workerId,
      succeeded: true,
      errorCode: null,
      retryDelaySeconds: 0,
    });
  } catch (error) {
    await persistAIProviderFailure(
      input.database,
      input.job.userId,
      error,
    ).catch(() => undefined);
    return finishJob(input.database, {
      jobId: input.job.jobId,
      workerId: input.workerId,
      succeeded: false,
      errorCode: jobErrorCode(error),
      retryDelaySeconds: retryDelaySeconds(input.job.attemptCount),
    });
  }
}

function isPipelineStage(value: unknown): value is AnalysisPipelineStage {
  return value === "analysis" || value === "claims" || value === "gap";
}

async function loadRepresentativeAssets(
  database: SupabaseClient,
  job: ClaimedJob,
): Promise<AnalysisRepresentativeAsset[]> {
  const links = await database
    .from("sequence_assets")
    .select("asset_id,position")
    .eq("user_id", job.userId)
    .eq("sequence_id", job.sequenceId)
    .eq("is_representative", true)
    .order("position", { ascending: true })
    .limit(4);
  if (links.error !== null || links.data.length === 0) {
    throw new Error("Sequence representatives were not found.");
  }
  const assetIds = links.data.map(({ asset_id }) => asset_id);
  const assets = await database
    .from("media_assets")
    .select("id,captured_at,coarse_place,derivative_storage_key")
    .eq("user_id", job.userId)
    .in("id", assetIds);
  if (assets.error !== null || assets.data.length !== assetIds.length) {
    throw new Error("Sequence representative assets were incomplete.");
  }
  const rowsById = new Map(assets.data.map((asset) => [asset.id, asset]));
  const result: AnalysisRepresentativeAsset[] = [];
  for (const assetId of assetIds) {
    const asset = rowsById.get(assetId);
    if (
      asset === undefined ||
      typeof asset.derivative_storage_key !== "string"
    ) {
      throw new Error("Sequence derivative path was missing.");
    }
    const downloaded = await database.storage
      .from("rememory-private")
      .download(asset.derivative_storage_key);
    if (downloaded.error !== null) {
      throw new Error("Sequence derivative download failed.");
    }
    const derivative = Buffer.from(await downloaded.data.arrayBuffer());
    const metadata = await sharp(derivative).metadata();
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new Error("Sequence derivative dimensions were invalid.");
    }
    result.push({
      id: asset.id,
      capturedAt: asset.captured_at,
      coarsePlace: asset.coarse_place,
      derivative,
      derivativeWidth: metadata.width,
      derivativeHeight: metadata.height,
    });
  }
  return result;
}

async function touchJob(
  database: SupabaseClient,
  jobId: string,
  workerId: string,
  stage: AnalysisPipelineStage,
) {
  const result = await database.rpc("touch_sequence_analysis_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_stage: stage,
    p_lease_seconds: JOB_LEASE_SECONDS,
  });
  if (result.error !== null || result.data !== true) {
    throw new Error("Sequence analysis job heartbeat failed.");
  }
}

async function finishJob(
  database: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    succeeded: boolean;
    errorCode: string | null;
    retryDelaySeconds: number;
  },
): Promise<"complete" | "retry_wait" | "dead"> {
  const result = await database.rpc("finish_sequence_analysis_job", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_succeeded: input.succeeded,
    p_error_code: input.errorCode,
    p_retry_delay_seconds: input.retryDelaySeconds,
  });
  if (
    result.error !== null ||
    !["complete", "retry_wait", "dead"].includes(result.data)
  ) {
    throw new Error("Sequence analysis job finalization failed.");
  }
  return result.data as "complete" | "retry_wait" | "dead";
}

function retryDelaySeconds(attemptCount: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attemptCount - 1));
}

function jobErrorCode(error: unknown): string {
  if (error instanceof AIProviderError) return `ai_${error.code}`.slice(0, 120);
  if (error instanceof Error && error.name.length > 0) {
    return error.name.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 120);
  }
  return "analysis_failed";
}
