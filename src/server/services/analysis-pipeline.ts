import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assessContextCompleteness,
  evaluateMemoryGapGate,
} from "@/src/domain/memory-assessment";
import {
  SupabaseAICostLedger,
  SupabaseRateLimitStore,
  createAIProviderFromEnv,
  persistAIRun,
} from "@/src/server/ai";

export type AnalysisPipelineStage = "analysis" | "claims" | "gap";

export interface AnalysisRepresentativeAsset {
  id: string;
  capturedAt: string | null;
  coarsePlace: string | null;
  derivative: Buffer;
  derivativeWidth: number;
  derivativeHeight: number;
}

const UPLOAD_AI_ENVIRONMENT = {
  ...process.env,
  AI_REQUEST_TIMEOUT_MS: process.env.AI_UPLOAD_TIMEOUT_MS ?? "8000",
  AI_MAX_RETRIES: "0",
};

export async function analyzePersistedSequence(input: {
  userId: string;
  requestId: string;
  sequenceId: string;
  memoryId: string;
  representativeAssets: AnalysisRepresentativeAsset[];
  database: SupabaseClient;
  onStage?: (stage: AnalysisPipelineStage) => Promise<void>;
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
  if (eventResult.error !== null) {
    throw new Error("Event ownership check failed.");
  }

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
    if (evidenceInsert.error !== null) {
      throw new Error("AI evidence persistence failed.");
    }
  }
  await input.onStage?.("claims");

  const allEvidenceResult = await input.database
    .from("evidence")
    .select("id,field,value_json,source_type")
    .eq("user_id", input.userId)
    .eq("event_id", eventResult.data.id)
    .eq("validity", "valid")
    .limit(100);
  if (allEvidenceResult.error !== null) {
    throw new Error("Evidence loading failed.");
  }
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
  if (updateMemory.error !== null) {
    throw new Error("Memory reconstruction update failed.");
  }

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
      const dimensionUpdate = await input.database
        .from("memory_context_dimensions")
        .update({
          status: "known",
          active_claim_id: claimId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", input.userId)
        .eq("memory_id", input.memoryId)
        .eq("dimension", dimension);
      if (dimensionUpdate.error !== null) {
        throw new Error("Memory context update failed.");
      }
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
  await input.onStage?.("gap");

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
