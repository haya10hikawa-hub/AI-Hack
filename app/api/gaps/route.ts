import { NextRequest } from "next/server";
import { z } from "zod";

import { requestId } from "@/src/server/http/security";
import { dataResponse, routeError } from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import { resolveRequestAuth } from "@/src/server/supabase/auth";

const GapRowSchema = z.object({
  id: z.string().uuid(),
  memory_id: z.string().uuid(),
  question: z.string().min(1),
  options_json: z.unknown(),
  candidate_value_json: z.unknown(),
  reason_json: z.unknown(),
  status: z.string(),
  memory: z.union([
    z.object({ title: z.string() }),
    z.array(z.object({ title: z.string() })),
  ]),
});

function firstText(value: unknown, key: string): string | null {
  if (Array.isArray(value)) {
    const first = value[0];
    if (first !== null && typeof first === "object") {
      const field = (first as Record<string, unknown>)[key];
      return typeof field === "string" ? field.slice(0, 300) : null;
    }
  }
  if (value !== null && typeof value === "object") {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === "string" ? field.slice(0, 300) : null;
  }
  return null;
}

function candidateText(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 300);
  for (const key of [
    "value",
    "label",
    "text",
    "name",
    "activity",
    "purpose",
    "result",
    "people",
  ] as const) {
    const text = firstText(value, key);
    if (text !== null) return text;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const { user, supabase } = await resolveRequestAuth(request);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("memory_gaps")
      .select(
        "id,memory_id,question,options_json,candidate_value_json,reason_json,status,memory:memories(title)",
      )
      .eq("user_id", user.id)
      .or(
        `status.eq.ready_to_ask,and(status.eq.deferred,deferred_until.lte.${now})`,
      )
      .order("created_at", { ascending: true })
      .limit(20);
    if (error !== null) throw new RepositoryError("list_memory_gaps");

    const gaps = (data ?? [])
      .map((row) => GapRowSchema.safeParse(row))
      .filter((result) => result.success)
      .map(({ data: gap }) => ({
        id: gap.id,
        memoryId: gap.memory_id,
        memoryTitle: Array.isArray(gap.memory)
          ? (gap.memory[0]?.title ?? "タイトル未設定の記憶")
          : gap.memory.title,
        question: gap.question,
        candidateLabel:
          candidateText(gap.candidate_value_json) ??
          firstText(gap.options_json, "label"),
        evidenceSummary: firstText(gap.reason_json, "evidenceSummary"),
        state: "open" as const,
      }));
    return dataResponse({ gaps, partial: false, partialMessage: null });
  } catch (error) {
    return routeError(error, id);
  }
}
