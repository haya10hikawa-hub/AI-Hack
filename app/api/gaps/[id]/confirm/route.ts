import { NextRequest } from "next/server";
import { z } from "zod";

import { assertMutationAllowed, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import { refreshMemoryRelations } from "@/src/server/services/memory-relations";
import { resolveRequestAuth } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const RequestSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("confirm"),
      correctionText: z.undefined().optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("later"),
      correctionText: z.undefined().optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("correct"),
      correctionText: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = requestId(request);
  try {
    assertMutationAllowed(request);
    const gapId = z.uuid().parse((await context.params).id);
    const input = RequestSchema.parse(await request.json());
    const { user } = await resolveRequestAuth(request);
    const database = createSupabaseAdminClient();
    const gapResult = await database
      .from("memory_gaps")
      .select("id,memory_id,dimension,status")
      .eq("user_id", user.id)
      .eq("id", gapId)
      .maybeSingle();
    if (gapResult.error !== null)
      throw new RepositoryError("load_confirmation_gap");
    if (gapResult.data === null) {
      return errorResponse(
        404,
        "GAP_NOT_FOUND",
        "確認事項が見つかりません。",
        id,
      );
    }
    if (input.decision === "later") {
      const deferredUntil = new Date(
        Date.now() + 24 * 60 * 60 * 1_000,
      ).toISOString();
      const deferred = await database
        .from("memory_gaps")
        .update({ status: "deferred", deferred_until: deferredUntil })
        .eq("user_id", user.id)
        .eq("id", gapId)
        .in("status", ["detected", "ready_to_ask", "deferred"])
        .select("deferred_until")
        .maybeSingle();
      if (deferred.error !== null)
        throw new RepositoryError("defer_confirmation_gap");
      if (deferred.data === null) {
        return errorResponse(
          409,
          "GAP_NOT_ANSWERABLE",
          "この確認事項はすでに解決されています。",
          id,
        );
      }
      return dataResponse({
        saved: true,
        deferred: true,
        deferredUntil: deferred.data.deferred_until,
        createdClaimId: null,
      });
    }

    const value =
      input.decision === "correct" ? { value: input.correctionText } : null;
    const action = input.decision === "correct" ? "replace" : "confirm";
    const idempotencyKey = await stableUuidFromRequest(
      user.id,
      gapId,
      action,
      value,
    );
    const corrected = await database.rpc("apply_memory_gap_correction", {
      p_user_id: user.id,
      p_gap_id: gapId,
      p_action: action,
      p_value_json: value,
      p_field: gapResult.data.dimension,
      p_idempotency_key: idempotencyKey,
    });
    if (corrected.error !== null)
      throw new RepositoryError("apply_memory_gap_correction");
    const result = Array.isArray(corrected.data)
      ? corrected.data[0]
      : corrected.data;
    await refreshMemoryRelations({
      client: database,
      userId: user.id,
      memoryId: gapResult.data.memory_id,
    }).catch(() => undefined);
    return dataResponse({
      saved: true,
      createdClaimId:
        result !== null &&
        typeof result === "object" &&
        "created_claim_id" in result
          ? result.created_claim_id
          : null,
    });
  } catch (error) {
    return routeError(error, id);
  }
}

async function stableUuidFromRequest(
  userId: string,
  gapId: string,
  action: string,
  value: unknown,
): Promise<string> {
  const input = `${userId}\0${gapId}\0${action}\0${JSON.stringify(value)}`;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  ).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
