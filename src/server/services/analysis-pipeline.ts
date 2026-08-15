import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assessContextCompleteness,
  evaluateMemoryGapGate,
} from "@/src/domain/memory-assessment";
import {
  describeEventSemantics,
  type AssetSemanticRepresentation,
} from "@/src/domain/event-semantics";
import { distillMemoryRepresentatives } from "@/src/domain/memory-distillation";
import {
  SupabaseAICostLedger,
  SupabaseRateLimitStore,
  createAIProviderFromEnv,
  persistAIRun,
  toAssetSemanticRepresentations,
} from "@/src/server/ai";
import { persistMemoryRepresentatives } from "@/src/server/services/memory-distillation";
import { refreshMemoryRelations } from "@/src/server/services/memory-relations";

export type AnalysisPipelineStage = "analysis" | "claims" | "gap";

export interface AnalysisRepresentativeAsset {
  id: string;
  capturedAt: string | null;
  coarsePlace: string | null;
  derivative: Buffer;
  derivativeWidth: number;
  derivativeHeight: number;
}

export interface AnalysisPipelineProgress {
  complete: boolean;
  nextStage: AnalysisPipelineStage | null;
}

interface ActiveClaimSnapshot {
  id: string;
  field: string;
  value: unknown;
  origin: "deterministic" | "ai" | "user";
  confirmationStatus: "unconfirmed" | "user_confirmed" | "disputed";
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
  resumeFrom?: AnalysisPipelineStage;
  onStage?: (stage: AnalysisPipelineStage) => Promise<void>;
  stopAfterStage?: boolean;
}): Promise<AnalysisPipelineProgress> {
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
  const resumeFrom = input.resumeFrom ?? "analysis";
  const [eventResult, memoryResult] = await Promise.all([
    input.database
      .from("events")
      .select("id")
      .eq("user_id", input.userId)
      .eq("sequence_id", input.sequenceId)
      .single(),
    input.database
      .from("memories")
      .select("importance_band,summary")
      .eq("user_id", input.userId)
      .eq("id", input.memoryId)
      .single(),
  ]);
  if (eventResult.error !== null || memoryResult.error !== null) {
    throw new Error("Analysis ownership check failed.");
  }

  let summaryCandidate =
    typeof memoryResult.data.summary === "string"
      ? memoryResult.data.summary
      : "AI再構成の要約はありません。";

  if (resumeFrom === "analysis") {
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
    const semantics = toAssetSemanticRepresentations(analysis.data);
    const semanticsByAsset = new Map(
      semantics.map((semantic) => [semantic.assetId, semantic]),
    );
    const corroboration = corroborationCounts(semantics);
    const presentation = describeEventSemantics(semantics);
    const evidenceRows = semantics.flatMap((semantic) =>
      semantic.facets.map((facet) => {
        const corroborated = (corroboration.get(facetKey(facet)) ?? 0) >= 2;
        // A facet seen across multiple photos is stronger evidence than a
        // single-photo glimpse: treat a corroborated low-confidence guess as
        // medium confidence rather than discarding it as uncertain.
        const confidenceBand =
          corroborated && facet.confidenceBand === "low"
            ? ("medium" as const)
            : facet.confidenceBand;
        const value = {
          value: facet.value,
          confidenceBand,
          uncertainty: facet.uncertainty,
          corroborated,
        };
        return {
          id: crypto.randomUUID(),
          user_id: input.userId,
          event_id: eventResult.data.id,
          asset_id: semantic.assetId,
          kind: "ai_observation",
          field: facet.type,
          value_json: value,
          source_type: "ai_observation",
          source_version: analysis.run.schemaVersion,
          dedupe_key: stablePipelineKey(
            input.sequenceId,
            `evidence:${semantic.assetId}`,
            facet.type,
            value,
          ),
          observed_at: null,
          validity: confidenceBand === "low" ? "uncertain" : "valid",
        };
      }),
    );
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
    const updateMemory = await input.database
      .from("memories")
      .update({
        title: presentation.title,
        summary: presentation.summary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.memoryId)
      .eq("user_id", input.userId);
    if (updateMemory.error !== null) {
      throw new Error("Memory reconstruction update failed.");
    }
    summaryCandidate = presentation.summary;
    await refreshMemoryRelations({
      client: input.database,
      userId: input.userId,
      memoryId: input.memoryId,
    }).catch(() => undefined);
    try {
      await persistMemoryRepresentatives({
        client: input.database,
        userId: input.userId,
        memoryId: input.memoryId,
        aiRunId: analysisRunId,
        representatives: distillMemoryRepresentatives(
          input.representativeAssets.map((asset) => ({
            assetId: asset.id,
            capturedAt: asset.capturedAt,
            semantics: semanticsByAsset.get(asset.id) ?? {
              assetId: asset.id,
              facets: [],
            },
          })),
        ),
      });
    } catch {
      // Deterministic sequence representatives remain available.
    }
    await input.onStage?.("claims");
    if (input.stopAfterStage === true) {
      return { complete: false, nextStage: "claims" };
    }
  }

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
    "user_statement",
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
        | "system"
        | "user_statement",
    }));
  if (resumeFrom !== "gap") {
    const generated = await provider.generateEventClaims(context, {
      memoryId: input.memoryId,
      evidence: claimInputEvidence,
    });
    const claimsRunId = await persistAIRun(
      input.database,
      input.userId,
      generated.run,
    );
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
    }
  }

  const activeClaimsResult = await input.database
    .from("claims")
    .select(
      "id,field,value_json,origin,confirmation_status,confidence_band,status,created_at",
    )
    .eq("user_id", input.userId)
    .eq("memory_id", input.memoryId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (activeClaimsResult.error !== null) {
    throw new Error("Active claims loading failed.");
  }
  const activeClaims: ActiveClaimSnapshot[] = activeClaimsResult.data
    .filter(
      (claim) =>
        (claim.origin === "deterministic" ||
          claim.origin === "ai" ||
          claim.origin === "user") &&
        (claim.confirmation_status === "unconfirmed" ||
          claim.confirmation_status === "user_confirmed" ||
          claim.confirmation_status === "disputed") &&
        claim.confirmation_status !== "disputed" &&
        (claim.origin !== "ai" ||
          claim.confidence_band === "medium" ||
          claim.confidence_band === "high"),
    )
    .map((claim) => ({
      id: claim.id,
      field: claim.field,
      value: claim.value_json,
      origin: claim.origin as ActiveClaimSnapshot["origin"],
      confirmationStatus:
        claim.confirmation_status as ActiveClaimSnapshot["confirmationStatus"],
    }));

  const knownFields = preferredClaimsByField(activeClaims);
  for (const [field, dimension] of [
    ["activity", "activity"],
    ["purpose", "purpose"],
    ["people", "people"],
    ["result", "result"],
  ] as const) {
    const claim = knownFields.get(field);
    if (claim !== undefined) {
      const dimensionUpdate = await input.database
        .from("memory_context_dimensions")
        .update({
          status: "known",
          active_claim_id: claim.id,
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
  const contextRowsResult = await input.database
    .from("memory_context_dimensions")
    .select("dimension,status,importance_weight,active_claim_id")
    .eq("user_id", input.userId)
    .eq("memory_id", input.memoryId);
  if (contextRowsResult.error !== null) {
    throw new Error("Memory gap inputs failed.");
  }
  const refreshedRows = contextRowsResult.data.map((row) => {
    const claim = knownFields.get(row.dimension);
    return {
      dimension: row.dimension,
      status: claim === undefined ? row.status : "known",
      importanceWeight: row.importance_weight,
      activeClaimId: claim?.id ?? row.active_claim_id,
    };
  });
  await input.onStage?.("gap");
  if (input.stopAfterStage === true && resumeFrom !== "gap") {
    return { complete: false, nextStage: "gap" };
  }

  const completeness = assessContextCompleteness(refreshedRows);
  if (
    memoryResult.data.importance_band !== "low" &&
    completeness.missingDimensions.length > 0
  ) {
    const gapAI = await provider.detectMemoryGap(context, {
      memoryId: input.memoryId,
      importanceBand: memoryResult.data.importance_band,
      missingDimensions: completeness.missingDimensions,
      knownFacts: activeClaims.slice(0, 50).map((claim) => ({
        claimId: claim.id,
        field: claim.field,
        value: claim.value as never,
        truthLayer:
          claim.origin === "user" &&
          claim.confirmationStatus === "user_confirmed"
            ? ("user_confirmed" as const)
            : claim.origin === "ai"
              ? ("ai_inference" as const)
              : ("deterministic" as const),
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
              evidenceSummary: summaryCandidate,
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

  return { complete: true, nextStage: null };
}

function preferredClaimsByField(claims: ActiveClaimSnapshot[]) {
  const preferred = new Map<string, ActiveClaimSnapshot>();
  for (const claim of [...claims].sort(
    (left, right) => claimPriority(right) - claimPriority(left),
  )) {
    if (!preferred.has(claim.field)) preferred.set(claim.field, claim);
  }
  return preferred;
}

function claimPriority(claim: ActiveClaimSnapshot): number {
  if (
    claim.origin === "user" &&
    claim.confirmationStatus === "user_confirmed"
  ) {
    return 3;
  }
  return claim.origin === "deterministic" ? 2 : 1;
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

/** Counts how many distinct assets observed each normalized (type, value) facet. */
function corroborationCounts(
  semantics: readonly AssetSemanticRepresentation[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const semantic of semantics) {
    const seen = new Set<string>();
    for (const facet of semantic.facets) {
      const key = facetKey(facet);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function facetKey(facet: { type: string; value: string }): string {
  return `${facet.type}\0${facet.value.toLocaleLowerCase("en-US")}`;
}
