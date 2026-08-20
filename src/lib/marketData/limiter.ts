/**
 * Per-provider rate limiting + circuit breaker — pure module (no I/O).
 *
 * A provider that answered 429 (or failed repeatedly) must NOT be retried
 * dozens of times: it is tripped open for a cooldown that grows exponentially,
 * so the cascade skips it immediately and falls through to the next source.
 */
import type { Clock } from "./async-cache";

export type DenyReason = "CIRCUIT_OPEN" | "RATE_LIMIT";

export interface GuardConfig {
  /** Hard cap of upstream calls per rolling minute. */
  maxPerMinute: number;
  /** Minimum spacing between two calls (provider burst protection). */
  minIntervalMs?: number;
  /** Base cooldown applied on the first failure; doubles per consecutive one. */
  baseCooldownMs?: number;
  maxCooldownMs?: number;
}

export type Acquisition = { ok: true } | { ok: false; reason: DenyReason; retryAfterMs: number };

export class ProviderGuard {
  private calls: number[] = [];
  private openUntil = 0;
  private consecutiveFailures = 0;

  constructor(
    readonly provider: string,
    private cfg: GuardConfig,
    private clock: Clock = Date.now,
  ) {}

  private prune(now: number): void {
    this.calls = this.calls.filter((t) => now - t < 60_000);
  }

  isOpen(): boolean {
    return this.clock() < this.openUntil;
  }

  tryAcquire(): Acquisition {
    const now = this.clock();
    if (now < this.openUntil) {
      return { ok: false, reason: "CIRCUIT_OPEN", retryAfterMs: this.openUntil - now };
    }
    this.prune(now);
    if (this.calls.length >= this.cfg.maxPerMinute) {
      const oldest = this.calls[0];
      return {
        ok: false,
        reason: "RATE_LIMIT",
        retryAfterMs: Math.max(0, 60_000 - (now - oldest)),
      };
    }
    const min = this.cfg.minIntervalMs ?? 0;
    const last = this.calls[this.calls.length - 1];
    if (min > 0 && last !== undefined && now - last < min) {
      return { ok: false, reason: "RATE_LIMIT", retryAfterMs: min - (now - last) };
    }
    this.calls.push(now);
    return { ok: true };
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  /** Trip the breaker. `retryAfterMs` (from a 429 Retry-After) always wins. */
  onFailure(kind: "rate_limited" | "quota" | "error", retryAfterMs?: number): void {
    this.consecutiveFailures += 1;
    const base = this.cfg.baseCooldownMs ?? 30_000;
    const max = this.cfg.maxCooldownMs ?? 15 * 60_000;
    const backoff = Math.min(max, base * 2 ** (this.consecutiveFailures - 1));
    const floor = kind === "quota" ? Math.max(backoff, 5 * 60_000) : backoff;
    this.openUntil = this.clock() + Math.max(retryAfterMs ?? 0, floor);
  }

  cooldownRemainingMs(): number {
    return Math.max(0, this.openUntil - this.clock());
  }
}

export const DEFAULT_POLICIES: Record<string, GuardConfig> = {
  // MetalPrice Professional refreshes the quote about every 60s and bills every
  // request, so a high ceiling would only duplicate the same rate. Left as-is.
  metalpriceapi: { maxPerMinute: 10, minIntervalMs: 1_000, baseCooldownMs: 60_000 },
  polygon: { maxPerMinute: 30, minIntervalMs: 250, baseCooldownMs: 30_000 },
  // Internal ceiling BELOW the observed Twelve Data Grow account limit of 144
  // credits/minute. `/price` and `/time_series` cost 1 credit per symbol, so 60
  // upstream acquisitions/min leaves ~84 credits/min of headroom for other
  // background work (scanner, evaluator, MTF). Previously 8 (Basic-plan value).
  twelvedata: { maxPerMinute: 60, minIntervalMs: 1_000, baseCooldownMs: 60_000 },
  alphavantage: { maxPerMinute: 5, minIntervalMs: 12_000, baseCooldownMs: 120_000 },
  fmp: { maxPerMinute: 10, minIntervalMs: 500, baseCooldownMs: 60_000 },
};


export class GuardRegistry {
  private guards = new Map<string, ProviderGuard>();

  constructor(
    private policies: Record<string, GuardConfig> = DEFAULT_POLICIES,
    private clock: Clock = Date.now,
  ) {}

  get(provider: string): ProviderGuard {
    let g = this.guards.get(provider);
    if (!g) {
      g = new ProviderGuard(
        provider,
        this.policies[provider] ?? { maxPerMinute: 20, baseCooldownMs: 30_000 },
        this.clock,
      );
      this.guards.set(provider, g);
    }
    return g;
  }

  reset(): void {
    this.guards.clear();
  }
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
