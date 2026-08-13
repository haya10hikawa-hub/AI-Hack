import { z } from "zod";

export const RateLimitPolicySchema = z
  .object({
    namespace: z.string().regex(/^[a-z0-9_-]{1,40}$/u),
    limit: z.number().int().positive().max(100_000),
    windowMs: z
      .number()
      .int()
      .min(1_000)
      .max(24 * 60 * 60 * 1000),
  })
  .strict();

export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;

export interface RateLimitStore {
  increment(
    key: string,
    windowStartedAtMs: number,
    expiresAtMs: number,
  ): Promise<number>;
}

export type RateLimitDecision =
  | {
      allowed: true;
      remaining: number;
      resetAt: Date;
    }
  | {
      allowed: false;
      remaining: 0;
      resetAt: Date;
      reason: "limit_exceeded" | "store_unavailable";
    };

export interface RateLimiter {
  consume(subject: string): Promise<RateLimitDecision>;
}

/** Fixed-window limiter. Supply a shared store in production. Store failures deny. */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly policy: RateLimitPolicy;

  constructor(
    policy: RateLimitPolicy,
    private readonly store: RateLimitStore,
    private readonly now: () => number = Date.now,
  ) {
    this.policy = RateLimitPolicySchema.parse(policy);
  }

  async consume(subject: string): Promise<RateLimitDecision> {
    const safeSubject = z.string().min(1).max(300).parse(subject);
    const now = this.now();
    const windowStartedAtMs =
      Math.floor(now / this.policy.windowMs) * this.policy.windowMs;
    const expiresAtMs = windowStartedAtMs + this.policy.windowMs;
    const key = `${this.policy.namespace}:${safeSubject}:${windowStartedAtMs}`;

    try {
      const count = await this.store.increment(
        key,
        windowStartedAtMs,
        expiresAtMs,
      );
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error("Rate-limit store returned an invalid count.");
      }
      if (count > this.policy.limit) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(expiresAtMs),
          reason: "limit_exceeded",
        };
      }
      return {
        allowed: true,
        remaining: this.policy.limit - count,
        resetAt: new Date(expiresAtMs),
      };
    } catch {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(expiresAtMs),
        reason: "store_unavailable",
      };
    }
  }
}

/** Test/local-only store. Serverless production must use a shared atomic store. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<
    string,
    { count: number; expiresAtMs: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  async increment(
    key: string,
    _windowStartedAtMs: number,
    expiresAtMs: number,
  ): Promise<number> {
    const current = this.windows.get(key);
    if (current === undefined || current.expiresAtMs <= this.now()) {
      this.windows.set(key, { count: 1, expiresAtMs });
      this.prune();
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, value] of this.windows) {
      if (value.expiresAtMs <= now) this.windows.delete(key);
    }
  }
}
