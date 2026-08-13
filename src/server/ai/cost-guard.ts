import { z } from "zod";

import type { AIModelConfig } from "./model-router";
import { AIProviderError, type AIPurpose } from "./provider";

const CostReservationRequestSchema = z
  .object({
    userId: z.string().min(1).max(200),
    purpose: z.string().min(1).max(80),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    amountUsd: z.number().positive().max(1_000_000),
    dailyLimitUsd: z.number().positive().max(1_000_000),
  })
  .strict();

export interface CostLedgerReservation {
  id: string;
  amountUsd: number;
}

export interface AICostLedger {
  reserve(
    request: z.infer<typeof CostReservationRequestSchema>,
  ): Promise<CostLedgerReservation | null>;
  commit(reservationId: string, actualCostUsd: number): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export interface CostGuardReservation {
  id: string;
  reservedUsd: number;
  commit(actualCostUsd: number): Promise<void>;
  chargeConservatively(): Promise<void>;
  release(): Promise<void>;
}

export class AICostGuard {
  constructor(
    private readonly config: {
      dailyLimitUsd: number;
      perRequestLimitUsd: number;
    },
    private readonly ledger: AICostLedger,
    private readonly now: () => Date = () => new Date(),
  ) {
    z.number().positive().parse(config.dailyLimitUsd);
    z.number().positive().parse(config.perRequestLimitUsd);
  }

  async reserve(
    userId: string,
    purpose: AIPurpose,
    estimatedMaximumUsd: number,
  ): Promise<CostGuardReservation> {
    if (!Number.isFinite(estimatedMaximumUsd) || estimatedMaximumUsd <= 0) {
      throw new AIProviderError(
        "configuration_error",
        "AI request cost could not be estimated safely.",
      );
    }
    if (estimatedMaximumUsd > this.config.perRequestLimitUsd) {
      throw new AIProviderError("cost_limit", "AI request cost limit reached.");
    }

    let reservation: CostLedgerReservation | null;
    try {
      reservation = await this.ledger.reserve(
        CostReservationRequestSchema.parse({
          userId,
          purpose,
          dayKey: localDayKey(this.now()),
          amountUsd: estimatedMaximumUsd,
          dailyLimitUsd: this.config.dailyLimitUsd,
        }),
      );
    } catch (error) {
      throw new AIProviderError(
        "cost_limit",
        "AI cost ledger is unavailable; the request was denied.",
        false,
        { cause: error },
      );
    }
    if (reservation === null) {
      throw new AIProviderError("cost_limit", "Daily AI cost limit reached.");
    }

    let settled = false;
    const settleOnce = async (action: () => Promise<void>) => {
      if (settled) return;
      try {
        await action();
        settled = true;
      } catch (error) {
        throw new AIProviderError(
          "cost_limit",
          "AI cost ledger settlement failed.",
          false,
          { cause: error },
        );
      }
    };

    return {
      id: reservation.id,
      reservedUsd: reservation.amountUsd,
      commit: async (actualCostUsd) => {
        if (
          !Number.isFinite(actualCostUsd) ||
          actualCostUsd < 0 ||
          actualCostUsd > reservation!.amountUsd + 1e-9
        ) {
          throw new AIProviderError(
            "cost_limit",
            "Actual AI cost exceeded its reservation.",
          );
        }
        await settleOnce(() =>
          this.ledger.commit(reservation!.id, actualCostUsd),
        );
      },
      chargeConservatively: () =>
        settleOnce(() =>
          this.ledger.commit(reservation!.id, reservation!.amountUsd),
        ),
      release: () => settleOnce(() => this.ledger.release(reservation!.id)),
    };
  }
}

export function estimateAIRequestCost(input: {
  model: AIModelConfig;
  estimatedInputTokens: number;
  maximumOutputTokens?: number;
  inputImages: number;
}): number {
  const estimatedInputTokens = z
    .number()
    .int()
    .nonnegative()
    .parse(input.estimatedInputTokens);
  const maximumOutputTokens = z
    .number()
    .int()
    .positive()
    .parse(input.maximumOutputTokens ?? input.model.maxOutputTokens);
  const inputImages = z.number().int().nonnegative().parse(input.inputImages);

  return Math.max(
    0.000000001,
    roundCost(
      (estimatedInputTokens / 1_000_000) *
        input.model.inputUsdPerMillionTokens +
        (maximumOutputTokens / 1_000_000) *
          input.model.outputUsdPerMillionTokens +
        inputImages * input.model.imageUsdEach,
    ),
  );
}

export function estimateAIActualCost(input: {
  model: AIModelConfig;
  promptTokens: number | null;
  completionTokens: number | null;
  fallbackReservedUsd: number;
  inputImages: number;
}): number {
  if (input.promptTokens === null || input.completionTokens === null) {
    return input.fallbackReservedUsd;
  }
  return Math.min(
    input.fallbackReservedUsd,
    roundCost(
      (input.promptTokens / 1_000_000) * input.model.inputUsdPerMillionTokens +
        (input.completionTokens / 1_000_000) *
          input.model.outputUsdPerMillionTokens +
        input.inputImages * input.model.imageUsdEach,
    ),
  );
}

interface StoredReservation {
  id: string;
  scope: string;
  amountUsd: number;
  state: "reserved" | "committed";
}

/** Test/local-only ledger. Production should persist an atomic reservation. */
export class InMemoryAICostLedger implements AICostLedger {
  private readonly spent = new Map<string, number>();
  private readonly reservations = new Map<string, StoredReservation>();
  private sequence = 0;

  async reserve(
    rawRequest: z.infer<typeof CostReservationRequestSchema>,
  ): Promise<CostLedgerReservation | null> {
    const request = CostReservationRequestSchema.parse(rawRequest);
    const scope = `${request.userId}:${request.dayKey}`;
    const spent = this.spent.get(scope) ?? 0;
    const outstanding = [...this.reservations.values()]
      .filter((item) => item.scope === scope && item.state === "reserved")
      .reduce((sum, item) => sum + item.amountUsd, 0);
    if (spent + outstanding + request.amountUsd > request.dailyLimitUsd) {
      return null;
    }
    this.sequence += 1;
    const id = `cost-reservation-${this.sequence}`;
    this.reservations.set(id, {
      id,
      scope,
      amountUsd: request.amountUsd,
      state: "reserved",
    });
    return { id, amountUsd: request.amountUsd };
  }

  async commit(reservationId: string, actualCostUsd: number): Promise<void> {
    const reservation = this.requireOpen(reservationId);
    if (actualCostUsd < 0 || actualCostUsd > reservation.amountUsd + 1e-9) {
      throw new Error("Invalid reservation settlement amount.");
    }
    reservation.state = "committed";
    this.spent.set(
      reservation.scope,
      (this.spent.get(reservation.scope) ?? 0) + actualCostUsd,
    );
  }

  async release(reservationId: string): Promise<void> {
    this.requireOpen(reservationId);
    this.reservations.delete(reservationId);
  }

  getSpent(userId: string, dayKey: string): number {
    return this.spent.get(`${userId}:${dayKey}`) ?? 0;
  }

  private requireOpen(reservationId: string): StoredReservation {
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined || reservation.state !== "reserved") {
      throw new Error("Cost reservation is missing or already settled.");
    }
    return reservation;
  }
}

function localDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundCost(value: number): number {
  return Math.ceil(value * 1_000_000_000) / 1_000_000_000;
}
