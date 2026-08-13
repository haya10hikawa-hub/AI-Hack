import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AICostLedger,
  CostLedgerReservation,
} from "@/src/server/ai/cost-guard";
import type { RateLimitStore } from "@/src/server/security/rate-limit";

export class SupabaseRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async increment(
    key: string,
    windowStartedAtMs: number,
    expiresAtMs: number,
  ): Promise<number> {
    const { data, error } = await this.client.rpc("consume_ai_rate_limit", {
      p_user_id: this.userId,
      p_key: key,
      p_window_started_at_ms: windowStartedAtMs,
      p_expires_at_ms: expiresAtMs,
    });
    if (error !== null || typeof data !== "number") {
      throw new Error("The shared AI rate-limit store is unavailable.");
    }
    return data;
  }
}

export class SupabaseAICostLedger implements AICostLedger {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async reserve(request: {
    userId: string;
    purpose: string;
    dayKey: string;
    amountUsd: number;
    dailyLimitUsd: number;
  }): Promise<CostLedgerReservation | null> {
    if (request.userId !== this.userId) {
      throw new Error(
        "The AI cost owner does not match the authenticated user.",
      );
    }
    const { data, error } = await this.client.rpc("reserve_ai_cost", {
      p_user_id: this.userId,
      p_purpose: request.purpose,
      p_day_key: request.dayKey,
      p_amount_usd: request.amountUsd,
      p_daily_limit_usd: request.dailyLimitUsd,
    });
    if (error !== null)
      throw new Error("The shared AI cost ledger is unavailable.");
    return typeof data === "string"
      ? { id: data, amountUsd: request.amountUsd }
      : null;
  }

  async commit(reservationId: string, actualCostUsd: number): Promise<void> {
    const { error } = await this.client.rpc("commit_ai_cost", {
      p_user_id: this.userId,
      p_reservation_id: reservationId,
      p_actual_cost_usd: actualCostUsd,
    });
    if (error !== null)
      throw new Error("The shared AI cost ledger could not commit.");
  }

  async release(reservationId: string): Promise<void> {
    const { error } = await this.client.rpc("release_ai_cost", {
      p_user_id: this.userId,
      p_reservation_id: reservationId,
    });
    if (error !== null)
      throw new Error("The shared AI cost ledger could not release.");
  }
}
