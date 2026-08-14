import { NextRequest } from "next/server";
import { z } from "zod";

import {
  SupabaseAICostLedger,
  SupabaseRateLimitStore,
  createAIProviderFromEnv,
  persistAIProviderFailure,
  persistAIRun,
} from "@/src/server/ai";
import { collectGroundedFacts } from "@/src/domain/grounded-answer";
import { JsonValueSchema } from "@/src/domain/json";
import { selectSearchCandidates } from "@/src/domain/search";
import { assertSameOrigin, requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import {
  getMemoryThread,
  RepositoryError,
} from "@/src/server/services/memories";
import {
  normalizeSearchFeedbackQuery,
  searchFeedbackQueryHash,
} from "@/src/server/services/search-feedback";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  timezone: z.string().min(1).max(80).default("Asia/Tokyo"),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});

const StoredClaimSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value_json: JsonValueSchema,
  origin: z.enum(["deterministic", "ai", "user"]),
  confidence_band: z.enum(["low", "medium", "high", "unsupported"]),
  confirmation_status: z.enum(["unconfirmed", "user_confirmed", "disputed"]),
  status: z.enum([
    "generated",
    "active",
    "superseded",
    "rejected",
    "disputed",
    "unsupported",
    "deleted",
  ]),
  ai_run_id: z.string().uuid().nullable(),
  source_correction_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  claim_evidence: z
    .array(z.object({ evidence_id: z.string().uuid() }))
    .optional()
    .default([]),
});

type StoredClaim = z.infer<typeof StoredClaimSchema>;

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const id = requestId(request);
  let auditContext:
    | {
        database: ReturnType<typeof createSupabaseAdminClient>;
        userId: string;
      }
    | undefined;
  try {
    assertSameOrigin(request);
    const input = SearchRequestSchema.parse(await request.json());
    const { user, supabase } = await requireAuthenticatedUser();
    const database = createSupabaseAdminClient();
    auditContext = { database, userId: user.id };
    const provider = createAIProviderFromEnv({
      rateLimitStore: new SupabaseRateLimitStore(database, user.id),
      costLedger: new SupabaseAICostLedger(database, user.id),
    });
    const context = { userId: user.id, requestId: id, allowStrongModel: false };

    const preferenceResult = await supabase
      .from("user_preferences")
      .select("use_personal_context,search_learning_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (preferenceResult.error !== null)
      throw new RepositoryError("load_search_preferences");
    const aliasResult =
      preferenceResult.data?.use_personal_context === false
        ? { data: [], error: null }
        : await supabase
            .from("personal_context")
            .select("key,value_json")
            .eq("user_id", user.id)
            .eq("context_type", "alias")
            .eq("confirmation_status", "user_confirmed")
            .limit(50);
    if (aliasResult.error !== null)
      throw new RepositoryError("load_confirmed_aliases");
    const aliases = (aliasResult.data ?? []).flatMap((row) => {
      const to = stringValue(row.value_json);
      return typeof row.key === "string" && to !== null
        ? [{ from: row.key, to }]
        : [];
    });
    const feedbackEnabled =
      preferenceResult.data?.search_learning_enabled === true;
    const feedbackResult = feedbackEnabled
      ? await database
          .from("search_feedback")
          .select("memory_id,outcome")
          .eq("user_id", user.id)
          .eq(
            "query_hash",
            searchFeedbackQueryHash(normalizeSearchFeedbackQuery(input.query)),
          )
      : { data: [], error: null };
    if (feedbackResult.error !== null)
      throw new RepositoryError("load_search_feedback");
    const feedbackByMemoryId = new Map<string, "helpful" | "not_helpful">(
      (feedbackResult.data ?? []).flatMap((row) =>
        typeof row.memory_id === "string" &&
        (row.outcome === "helpful" || row.outcome === "not_helpful")
          ? [[row.memory_id, row.outcome] as const]
          : [],
      ),
    );
    const parsed = await provider.parseSearchQuery(context, {
      rawQuery: input.query,
      confirmedAliases: aliases,
      currentDate: input.currentDate,
      timezone: input.timezone,
    });
    await persistAIRun(database, user.id, parsed.run);

    const memoryResult = await supabase
      .from("memories")
      .select(
        "id,title,summary,status,event_id,event:events(id,started_at,coarse_place),claims(id,field,value_json,status,origin,confidence_band,confirmation_status,ai_run_id,source_correction_id,created_at,updated_at,claim_evidence(evidence_id))",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(100);
    if (memoryResult.error !== null)
      throw new RepositoryError("retrieve_memory_candidates");
    const candidates = (memoryResult.data ?? []).map((row) =>
      scoreCandidate(
        row,
        parsed.data,
        feedbackByMemoryId.get(String(row.id)) ?? null,
      ),
    );
    const eligible = candidates.filter(
      ({ structuredScore }) => structuredScore >= 0.2,
    );
    if (eligible.length === 0) {
      const thread = await getMemoryThread(supabase, user.id);
      return dataResponse({
        interpretation: toInterpretation(parsed.data),
        answer: null,
        answerState: "unknown",
        candidates: [],
        sources: [],
        clarification: null,
        partial: thread.partial,
        partialMessage: thread.partial
          ? "Memoryを再構成しています。完了後に同じ言葉でもう一度検索してください。"
          : null,
        feedbackEnabled,
      });
    }

    const reranked = await provider.rerankSearchCandidates(context, {
      query: parsed.data,
      candidates: eligible.slice(0, 30).map((candidate) => ({
        memoryId: candidate.id,
        date: candidate.startedAt,
        coarsePlace: candidate.coarsePlace,
        title: candidate.title,
        groundedTerms: candidate.groundedTerms,
      })),
    });
    await persistAIRun(database, user.id, reranked.run);
    const rerankMap = new Map(
      reranked.data.ranked.map((item) => [item.memoryId, item]),
    );
    const decision = selectSearchCandidates(
      eligible.map((candidate) => ({
        memoryId: candidate.id,
        status: "active" as const,
        structuredScore: candidate.structuredScore,
        rerankScore: rerankMap.get(candidate.id)?.score ?? null,
        matchReasons: [
          ...candidate.matchReasons,
          ...(rerankMap.get(candidate.id)?.matchReasons ?? []),
        ].slice(0, 10),
      })),
    );
    const thread = await getMemoryThread(supabase, user.id);
    const threadById = new Map(
      thread.memories.map((memory) => [memory.id, memory]),
    );
    const responseCandidates = (ids: string[]) =>
      ids.flatMap((memoryId) => {
        const memory = threadById.get(memoryId);
        const candidate = eligible.find(
          ({ id: candidateId }) => candidateId === memoryId,
        );
        const rerank = rerankMap.get(memoryId);
        return memory === undefined || candidate === undefined
          ? []
          : [
              {
                memory,
                matchReasons: [
                  ...candidate.matchReasons,
                  ...(rerank?.matchReasons ?? []),
                ]
                  .filter(
                    (reason, index, values) => values.indexOf(reason) === index,
                  )
                  .slice(0, 4),
              },
            ];
      });

    if (decision.kind === "ambiguous") {
      return dataResponse({
        interpretation: toInterpretation(parsed.data),
        answer: null,
        answerState: "clarification",
        candidates: responseCandidates(
          decision.alternatives.map(({ memoryId }) => memoryId),
        ),
        sources: [],
        clarification:
          "候補をひとつに決める根拠が足りません。近いMemoryを選んでください。",
        partial: thread.partial,
        partialMessage: thread.partialMessage,
        feedbackEnabled,
      });
    }
    if (decision.kind === "unknown") {
      return dataResponse({
        interpretation: toInterpretation(parsed.data),
        answer: null,
        answerState: "unknown",
        candidates: [],
        sources: [],
        clarification: null,
        partial: thread.partial,
        partialMessage: thread.partialMessage,
        feedbackEnabled,
      });
    }

    const selected = eligible.find(
      ({ id: memoryId }) => memoryId === decision.candidate.memoryId,
    )!;
    const [evidenceResult, correctionResult, gapResult] = await Promise.all([
      supabase
        .from("evidence")
        .select("id,source_type,validity")
        .eq("user_id", user.id)
        .eq("event_id", selected.eventId),
      supabase
        .from("user_corrections")
        .select(
          "id,memory_id,target_claim_id,action,value_json,created_claim_id,idempotency_key,created_at",
        )
        .eq("user_id", user.id)
        .eq("memory_id", selected.id),
      supabase
        .from("memory_gaps")
        .select("question")
        .eq("user_id", user.id)
        .eq("memory_id", selected.id)
        .eq("status", "ready_to_ask")
        .limit(1)
        .maybeSingle(),
    ]);
    if (
      evidenceResult.error !== null ||
      correctionResult.error !== null ||
      gapResult.error !== null
    ) {
      throw new RepositoryError("load_grounding_provenance");
    }
    const grounded = collectGroundedFacts({
      memoryId: selected.id,
      memoryStatus: "active",
      claims: selected.claims.map((claim) => ({
        id: claim.id,
        userId: user.id,
        memoryId: selected.id,
        field: claim.field,
        value: claim.value_json,
        origin: claim.origin,
        confidenceBand: claim.confidence_band,
        confirmationStatus: claim.confirmation_status,
        status: claim.status,
        evidenceIds: claim.claim_evidence.map((link) => link.evidence_id),
        aiRunId: claim.ai_run_id,
        sourceCorrectionId: claim.source_correction_id,
        dedupeKey: null,
        createdAt: claim.created_at,
        updatedAt: claim.updated_at,
      })),
      evidence: (evidenceResult.data ?? []).map((evidence) => ({
        id: evidence.id,
        userId: user.id,
        memoryId: selected.id,
        sourceType: evidence.source_type,
        validity: evidence.validity,
      })),
      corrections: (correctionResult.data ?? []).map((correction) => ({
        id: correction.id,
        userId: user.id,
        memoryId: correction.memory_id,
        targetClaimId: correction.target_claim_id,
        action: correction.action,
        value: correction.value_json,
        createdClaimId: correction.created_claim_id,
        idempotencyKey: correction.idempotency_key,
        createdAt: correction.created_at,
      })),
    });
    const answered = await provider.generateGroundedAnswer(context, {
      query: input.query,
      facts: grounded.facts.map((fact) => ({
        claimId: fact.claimId,
        field: fact.field,
        value: fact.value,
        truthLayer: fact.truthLayer,
      })),
      allowedClarificationQuestion: gapResult.data?.question ?? null,
    });
    await persistAIRun(database, user.id, answered.run);
    const answerText = answered.data.segments.map(({ text }) => text).join(" ");
    const citedIds = new Set(
      answered.data.segments.flatMap(({ claimIds }) => claimIds),
    );
    return dataResponse({
      interpretation: toInterpretation(parsed.data),
      answer: answerText || null,
      answerState:
        answered.data.mode === "answer"
          ? "grounded"
          : answered.data.mode === "clarification"
            ? "clarification"
            : "unknown",
      candidates: responseCandidates([selected.id]),
      sources: grounded.facts
        .filter(({ claimId }) => citedIds.has(claimId))
        .map((fact) => ({
          claimId: fact.claimId,
          label: `${fact.field}: ${displayValue(fact.value)}`,
          kind: fact.provenance.kind,
        })),
      clarification: answered.data.clarificationQuestion,
      partial: thread.partial,
      partialMessage: thread.partialMessage,
      feedbackEnabled,
    });
  } catch (error) {
    if (auditContext !== undefined) {
      await persistAIProviderFailure(
        auditContext.database,
        auditContext.userId,
        error,
      ).catch(() => undefined);
    }
    return routeError(error, id);
  }
}

type Parsed = Awaited<
  ReturnType<ReturnType<typeof createAIProviderFromEnv>["parseSearchQuery"]>
>["data"];

function scoreCandidate(
  row: Record<string, unknown>,
  query: Parsed,
  feedback: "helpful" | "not_helpful" | null,
) {
  const eventValue = Array.isArray(row.event) ? row.event[0] : row.event;
  const event = (eventValue ?? {}) as Record<string, unknown>;
  const claims: StoredClaim[] = Array.isArray(row.claims)
    ? row.claims.flatMap((claim) => {
        const parsed = StoredClaimSchema.safeParse(claim);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const title =
    typeof row.title === "string" ? row.title : "タイトル未設定の記憶";
  const summary = typeof row.summary === "string" ? row.summary : "";
  const coarsePlace =
    typeof event.coarse_place === "string" ? event.coarse_place : null;
  const startedAt =
    typeof event.started_at === "string" ? event.started_at : null;
  const groundedClaims = claims.filter(
    (claim) =>
      claim.status === "active" &&
      claim.confirmation_status !== "disputed" &&
      (claim.origin === "user"
        ? claim.confirmation_status === "user_confirmed"
        : (claim.confidence_band === "medium" ||
            claim.confidence_band === "high") &&
          claim.claim_evidence.length > 0),
  );
  const groundedTerms = groundedClaims.map(({ value_json }) =>
    displayValue(value_json),
  );
  const haystack = [title, summary, coarsePlace ?? "", ...groundedTerms]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const terms = [...query.activities, ...query.keywords, ...query.people];
  const matchedTerms = terms.filter((term) =>
    haystack.includes(term.normalize("NFKC").toLocaleLowerCase()),
  );
  if (matchedTerms.length > 0) {
    score += Math.min(0.5, matchedTerms.length * 0.18);
    reasons.push(`内容が一致: ${matchedTerms.slice(0, 2).join("、")}`);
  }
  const confirmedHaystack = groundedClaims
    .filter(
      ({ origin, confirmation_status }) =>
        origin === "user" && confirmation_status === "user_confirmed",
    )
    .map(({ value_json }) => displayValue(value_json))
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  const confirmedMatches = matchedTerms.filter((term) =>
    confirmedHaystack.includes(term.normalize("NFKC").toLocaleLowerCase()),
  );
  if (confirmedMatches.length > 0) {
    score = Math.max(0.25, score + 0.12);
    reasons.push("あなたが確認した内容と一致");
  }
  if (
    query.places.some((place) =>
      haystack.includes(place.normalize("NFKC").toLocaleLowerCase()),
    )
  ) {
    score += 0.3;
    reasons.push("場所が一致");
  }
  const date = startedAt?.slice(0, 10) ?? null;
  if (
    date !== null &&
    query.dateRange !== null &&
    (query.dateRange.from === null || date >= query.dateRange.from) &&
    (query.dateRange.to === null || date <= query.dateRange.to)
  ) {
    score += 0.35;
    reasons.push("時期が一致");
  }
  if (
    terms.length === 0 &&
    query.places.length === 0 &&
    query.dateRange === null
  )
    score = 0.25;
  if (feedback === "helpful") {
    score += 0.2;
    reasons.push("以前の検索で役に立ったMemory");
  } else if (feedback === "not_helpful") {
    score -= 0.3;
    reasons.push("以前の検索フィードバックを反映");
  }
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    title,
    startedAt,
    coarsePlace,
    groundedTerms,
    claims,
    structuredScore: Math.min(1, score),
    matchReasons: reasons,
  };
}

function toInterpretation(query: Parsed) {
  return {
    time:
      query.dateRange === null
        ? null
        : [query.dateRange.from, query.dateRange.to].filter(Boolean).join("〜"),
    place: query.places.join("、") || null,
    people: query.people,
    activities: query.activities,
    keywords: query.keywords,
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "label", "text", "name"]) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  return null;
}

function displayValue(value: unknown): string {
  return (
    stringValue(value) ??
    (typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "構造化された情報")
  );
}
