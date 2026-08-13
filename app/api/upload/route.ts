import { after, NextRequest } from "next/server";
import { z } from "zod";

import { requireRuntimeConfig } from "@/src/server/config";
import {
  SupabaseAICostLedger,
  SupabaseRateLimitStore,
  createAIProviderFromEnv,
  persistAIProviderFailure,
  persistAIRun,
} from "@/src/server/ai";
import {
  assessContextCompleteness,
  evaluateMemoryGapGate,
} from "@/src/domain/memory-assessment";
import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { ingestUpload } from "@/src/server/services/upload";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_AI_ENVIRONMENT = {
  ...process.env,
  // Three pipeline stages must settle inside the route's background budget.
  // Upload retries happen through the existing sequence lease/re-upload path.
  AI_REQUEST_TIMEOUT_MS: process.env.AI_UPLOAD_TIMEOUT_MS ?? "8000",
  AI_MAX_RETRIES: "0",
};

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

    // Return the deterministic Event/Memory checkpoint immediately. `after`
    // keeps the AI reconstruction running without blocking the upload screen.
    after(() =>
      processSequences({
        sequences: result.sequences,
        userId: user.id,
        requestId: id,
        database,
      }),
    );

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

async function processSequences(input: {
  sequences: Awaited<ReturnType<typeof ingestUpload>>["sequences"];
  userId: string;
  requestId: string;
  database: ReturnType<typeof createSupabaseAdminClient>;
}) {
  // Two sequences at a time keeps the demo responsive without opening an
  // unbounded number of vision/model requests for a large upload.
  const queue = [...input.sequences];
  const workers = Array.from(
    { length: Math.min(2, Math.max(1, queue.length)) },
    async () => {
      while (queue.length > 0) {
        const sequence = queue.shift();
        if (sequence === undefined) return;
        await processSequence({ ...input, sequence });
      }
    },
  );
  await Promise.all(workers);
}

async function processSequence(input: {
  sequence: Awaited<ReturnType<typeof ingestUpload>>["sequences"][number];
  userId: string;
  requestId: string;
  database: ReturnType<typeof createSupabaseAdminClient>;
}) {
  const { sequence, database } = input;
  if (sequence.representativeAssets.length === 0) return;
  const representativeIds = sequence.representativeAssets.map(
    ({ id: assetId }) => assetId,
  );
  const lease = await database.rpc("claim_sequence_analysis", {
    p_user_id: input.userId,
    p_sequence_id: sequence.sequenceId,
    p_asset_ids: representativeIds,
    p_lease_seconds: 300,
  });
  if (lease.error !== null || lease.data !== true) return;
  try {
    await analyzePersistedSequence({
      userId: input.userId,
      requestId: input.requestId,
      sequenceId: sequence.sequenceId,
      memoryId: sequence.memoryId,
      representativeAssets: sequence.representativeAssets,
      database,
    });
    const completed = await database.rpc("complete_sequence_analysis", {
      p_user_id: input.userId,
      p_sequence_id: sequence.sequenceId,
      p_status: "complete",
    });
    if (completed.error !== null || completed.data !== true) {
      throw new Error("Sequence analysis completion failed.");
    }
  } catch (error) {
    await persistAIProviderFailure(database, input.userId, error).catch(
      () => undefined,
    );
    await database.rpc("complete_sequence_analysis", {
      p_user_id: input.userId,
      p_sequence_id: sequence.sequenceId,
      p_status: "failed",
    });
  }
}

async function analyzePersistedSequence(input: {
  userId: string;
  requestId: string;
  sequenceId: string;
  memoryId: string;
  representativeAssets: Array<{
    id: string;
    mimeType: string;
    capturedAt: string | null;
    coarsePlace: string | null;
    derivative: Buffer;
    derivativeWidth: number;
    derivativeHeight: number;
  }>;
  database: ReturnType<typeof createSupabaseAdminClient>;
}) {
  const provider = createAIProviderFromEnv(
    {
      rateLimitStore: new SupabaseRateLimitStore(input.database, input.userId),
      costLedger: new SupabaseAICostLedger(input.database, input.userId),
    },
    UPLOAD_AI_ENVIRONMENT,
  );
  const context = {
    userId: input.userId,
    requestId: input.requestId,
    allowStrongModel: false,
  };
  const eventResult = await input.database
    .from("events")
    .select("id")
    .eq("user_id", input.userId)
    .eq("sequence_id", input.sequenceId)
    .single();
  if (eventResult.error !== null)
    throw new Error("Event ownership check failed.");

  const analysis = await provider.analyzeSequence(context, {
    sequenceId: input.sequenceId,
    assets: input.representativeAssets.slice(0, 4).map((asset) => ({
      assetId: asset.id,
      mimeType: "image/webp" as const,
      derivativeBase64: asset.derivative.toString("base64"),
      width: asset.derivativeWidth,
      height: asset.derivativeHeight,
      capturedAt: asset.capturedAt,
      coarsePlace: asset.coarsePlace,
    })),
  });
  const analysisRunId = await persistAIRun(
    input.database,
    input.userId,
    analysis.run,
  );
  const evidenceRows = analysis.data.observations.map((observation) => {
    const value = {
      value: observation.value,
      confidenceBand: observation.confidenceBand,
      uncertainty: observation.uncertainty,
    };
    return {
      id: crypto.randomUUID(),
      user_id: input.userId,
      event_id: eventResult.data.id,
      asset_id: observation.assetId,
      kind: "ai_observation",
      field: observation.field,
      value_json: value,
      source_type: "ai_observation",
      source_version: analysis.run.schemaVersion,
      dedupe_key: stablePipelineKey(
        input.sequenceId,
        `evidence:${observation.assetId}`,
        observation.field,
        value,
      ),
      observed_at: null,
      validity: observation.confidenceBand === "low" ? "uncertain" : "valid",
    };
  });
  if (evidenceRows.length > 0) {
    const evidenceInsert = await input.database
      .from("evidence")
      .upsert(evidenceRows, {
        onConflict: "user_id,dedupe_key",
        ignoreDuplicates: true,
      });
    if (evidenceInsert.error !== null)
      throw new Error("AI evidence persistence failed.");
  }

  const allEvidenceResult = await input.database
    .from("evidence")
    .select("id,field,value_json,source_type")
    .eq("user_id", input.userId)
    .eq("event_id", eventResult.data.id)
    .eq("validity", "valid")
    .limit(100);
  if (allEvidenceResult.error !== null)
    throw new Error("Evidence loading failed.");
  const allowedSourceTypes = new Set([
    "metadata",
    "ai_observation",
    "location",
    "system",
  ]);
  const claimInputEvidence = (allEvidenceResult.data ?? [])
    .filter(({ source_type }) => allowedSourceTypes.has(source_type))
    .map((entry) => ({
      evidenceId: entry.id,
      field: entry.field,
      value: entry.value_json,
      sourceType: entry.source_type as
        | "metadata"
        | "ai_observation"
        | "location"
        | "system",
    }));
  const generated = await provider.generateEventClaims(context, {
    memoryId: input.memoryId,
    evidence: claimInputEvidence,
  });
  const claimsRunId = await persistAIRun(
    input.database,
    input.userId,
    generated.run,
  );
  const createdClaims: Array<{ id: string; field: string; value: unknown }> =
    [];
  for (const claim of generated.data.claims) {
    const { data, error } = await input.database.rpc(
      "create_evidence_backed_claim",
      {
        p_user_id: input.userId,
        p_memory_id: input.memoryId,
        p_field: claim.field,
        p_value_json: claim.value,
        p_origin: "ai",
        p_confidence_band: claim.confidenceBand,
        p_evidence_ids: claim.evidenceIds,
        p_ai_run_id: claimsRunId,
        p_dedupe_key: stablePipelineKey(
          input.sequenceId,
          "claim",
          claim.field,
          claim.value,
        ),
        p_activate: claim.confidenceBand !== "low",
      },
    );
    if (error !== null || typeof data !== "string") {
      throw new Error("Evidence-backed AI claim transaction failed.");
    }
    if (claim.confidenceBand !== "low") {
      createdClaims.push({ id: data, field: claim.field, value: claim.value });
    }
  }
  const updateMemory = await input.database
    .from("memories")
    .update({
      title: analysis.data.titleCandidate,
      summary: analysis.data.summaryCandidate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.memoryId)
    .eq("user_id", input.userId);
  if (updateMemory.error !== null)
    throw new Error("Memory reconstruction update failed.");

  const contextRowsResult = await input.database
    .from("memory_context_dimensions")
    .select("dimension,status,importance_weight,active_claim_id")
    .eq("user_id", input.userId)
    .eq("memory_id", input.memoryId);
  const memoryResult = await input.database
    .from("memories")
    .select("importance_band")
    .eq("user_id", input.userId)
    .eq("id", input.memoryId)
    .single();
  if (contextRowsResult.error !== null || memoryResult.error !== null) {
    throw new Error("Memory gap inputs failed.");
  }
  const knownFields = new Map(
    createdClaims.map((claim) => [claim.field, claim.id]),
  );
  for (const [field, dimension] of [
    ["activity", "activity"],
    ["purpose", "purpose"],
    ["people", "people"],
    ["result", "result"],
  ] as const) {
    const claimId = knownFields.get(field);
    if (claimId !== undefined) {
      await input.database
        .from("memory_context_dimensions")
        .update({
          status: "known",
          active_claim_id: claimId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", input.userId)
        .eq("memory_id", input.memoryId)
        .eq("dimension", dimension);
    }
  }
  const refreshedRows = contextRowsResult.data.map((row) => {
    const claimId = knownFields.get(row.dimension);
    return {
      dimension: row.dimension,
      status: claimId === undefined ? row.status : "known",
      importanceWeight: row.importance_weight,
      activeClaimId: claimId ?? row.active_claim_id,
    };
  });
  const completeness = assessContextCompleteness(refreshedRows);
  if (
    memoryResult.data.importance_band !== "low" &&
    completeness.missingDimensions.length > 0
  ) {
    const gapAI = await provider.detectMemoryGap(context, {
      memoryId: input.memoryId,
      importanceBand: memoryResult.data.importance_band,
      missingDimensions: completeness.missingDimensions,
      knownFacts: createdClaims.map((claim) => ({
        claimId: claim.id,
        field: claim.field,
        value: claim.value as never,
        truthLayer: "ai_inference" as const,
      })),
      evidence: claimInputEvidence,
    });
    const gapRunId = await persistAIRun(
      input.database,
      input.userId,
      gapAI.run,
    );
    if (gapAI.data.candidate !== null) {
      const candidate = {
        id: crypto.randomUUID(),
        ...gapAI.data.candidate,
        askedCount: 0,
        status: "detected" as const,
      };
      const gate = evaluateMemoryGapGate({
        importance: memoryResult.data.importance_band,
        completeness,
        candidates: [candidate],
      });
      if (gate.ready) {
        const gapDedupeKey = stablePipelineKey(
          input.sequenceId,
          "gap",
          candidate.dimension,
          candidate.candidateValue,
        );
        const provisionalClaim = await input.database.rpc(
          "create_evidence_backed_claim",
          {
            p_user_id: input.userId,
            p_memory_id: input.memoryId,
            p_field: candidate.dimension,
            p_value_json: candidate.candidateValue,
            p_origin: "ai",
            p_confidence_band: candidate.confidenceBand,
            p_evidence_ids: candidate.evidenceIds,
            p_ai_run_id: gapRunId,
            p_dedupe_key: stablePipelineKey(
              input.sequenceId,
              "gap-claim",
              candidate.dimension,
              candidate.candidateValue,
            ),
            p_activate: false,
          },
        );
        if (
          provisionalClaim.error !== null ||
          typeof provisionalClaim.data !== "string"
        ) {
          throw new Error("Memory gap candidate claim persistence failed.");
        }
        const staleGaps = await input.database
          .from("memory_gaps")
          .update({ status: "dismissed" })
          .eq("user_id", input.userId)
          .eq("memory_id", input.memoryId)
          .eq("dimension", candidate.dimension)
          .in("status", ["detected", "ready_to_ask"])
          .neq("dedupe_key", gapDedupeKey);
        if (staleGaps.error !== null) {
          throw new Error("Previous Memory gap cleanup failed.");
        }
        const gapInsert = await input.database.from("memory_gaps").upsert(
          {
            id: candidate.id,
            user_id: input.userId,
            memory_id: input.memoryId,
            target_claim_id: provisionalClaim.data,
            dimension: candidate.dimension,
            gap_type: candidate.gapType,
            question: candidate.question,
            options_json: candidate.options,
            candidate_value_json: candidate.candidateValue,
            dedupe_key: gapDedupeKey,
            confidence_band: candidate.confidenceBand,
            reason_json: {
              candidateSpecificity: candidate.candidateSpecificity,
              candidateOptionValue: candidate.candidateOptionValue,
              evidenceSummary: analysis.data.summaryCandidate,
            },
            status: "ready_to_ask",
            asked_count: 0,
          },
          { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
        );
        if (gapInsert.error !== null) {
          throw new Error("Memory gap persistence failed.");
        }
      }
    }
  }
  void analysisRunId;
}

function stablePipelineKey(
  sequenceId: string,
  kind: string,
  field: string,
  value: unknown,
): string {
  const serialized = JSON.stringify(value) ?? "null";
  let hash = 0x811c9dc5;
  for (const character of serialized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${sequenceId}:pipeline-v1:${kind}:${field}:${(hash >>> 0).toString(16)}`.slice(
    0,
    200,
  );
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
