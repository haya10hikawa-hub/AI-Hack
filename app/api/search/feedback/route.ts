import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import {
  normalizeSearchFeedbackQuery,
  searchFeedbackQueryHash,
} from "@/src/server/services/search-feedback";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const FeedbackSchema = z.object({
  query: z.string().trim().min(1).max(500),
  memoryId: z.string().uuid(),
  outcome: z.enum(["helpful", "not_helpful"]),
});

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = FeedbackSchema.parse(await request.json());
    const { user, supabase } = await requireAuthenticatedUser();
    const preference = await supabase
      .from("user_preferences")
      .select("search_learning_enabled")
      .eq("user_id", user.id)
      .single();
    if (preference.error !== null)
      throw new RepositoryError("load_search_learning_preference");
    if (preference.data.search_learning_enabled !== true) {
      return errorResponse(
        409,
        "SEARCH_LEARNING_DISABLED",
        "検索学習を使うには、設定で有効にしてください。",
        id,
      );
    }

    const database = createSupabaseAdminClient();
    const memory = await database
      .from("memories")
      .select("id")
      .eq("id", input.memoryId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (memory.error !== null)
      throw new RepositoryError("validate_feedback_memory");
    if (memory.data === null) {
      return errorResponse(
        404,
        "MEMORY_NOT_FOUND",
        "対象のMemoryが見つかりません。",
        id,
      );
    }

    const normalizedQuery = normalizeSearchFeedbackQuery(input.query);
    const queryHash = searchFeedbackQueryHash(normalizedQuery);
    const existing = await database
      .from("search_feedback")
      .select("id,feedback_count")
      .eq("user_id", user.id)
      .eq("memory_id", input.memoryId)
      .eq("query_hash", queryHash)
      .maybeSingle();
    if (existing.error !== null)
      throw new RepositoryError("load_search_feedback");

    const saved = existing.data
      ? await database
          .from("search_feedback")
          .update({
            outcome: input.outcome,
            feedback_count: Math.min(existing.data.feedback_count + 1, 1000000),
          })
          .eq("id", existing.data.id)
          .eq("user_id", user.id)
      : await database.from("search_feedback").insert({
          user_id: user.id,
          memory_id: input.memoryId,
          query_hash: queryHash,
          normalized_query: normalizedQuery,
          outcome: input.outcome,
        });
    if (saved.error !== null) throw new RepositoryError("save_search_feedback");

    return dataResponse({ saved: true, outcome: input.outcome });
  } catch (error) {
    return routeError(error, id);
  }
}
