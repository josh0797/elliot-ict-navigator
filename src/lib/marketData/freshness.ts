/**
 * Freshness contract for market-data series.
 *
 * A provider that answers with SOME candles is not automatically acceptable:
 * during an active session a series lagging more than a couple of buckets is
 * unusable for Elliott/ICT/signals. Such a provider is skipped and the cascade
 * continues; if every provider is stale the snapshot is reported as DATA_STALE
 * and downstream analysis is blocked.
 *
 * Pure module (no provider I/O) so it is unit-testable and safe to import from
 * `*.functions.ts` wrappers.
 */

export type DataStatus = "OK" | "DATA_STALE";

export interface Freshness {
  status: DataStatus;
  /** Seconds between `now` and the open time of the last closed candle. */
  ageSeconds: number;
  stale: boolean;
  marketOpen: boolean;
  /** Tolerated age, in seconds, for this timeframe. */
  toleranceSeconds: number;
  reason?: string;
}

/** Forex/metals have no prints over the weekend — that is not stale data. */
export function marketLikelyOpen(now: Date = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 6) return false;
  if (day === 0 && now.getUTCHours() < 22) return false;
  if (day === 5 && now.getUTCHours() >= 22) return false;
  return true;
}

export function evaluateFreshness(input: {
  lastCandleTime: number;
  intervalSeconds: number;
  nowSeconds: number;
  marketOpen?: boolean;
}): Freshness {
  const marketOpen = input.marketOpen ?? marketLikelyOpen(new Date(input.nowSeconds * 1000));
  // One closed bar can legitimately be up to ~2 buckets old (open + close lag);
  // intraday gets a small floor so 15m does not flap on provider jitter.
  const toleranceSeconds = Math.max(input.intervalSeconds * 2 + 60, 300);
  const ageSeconds = Math.max(0, input.nowSeconds - input.lastCandleTime);
  const stale = marketOpen && ageSeconds > toleranceSeconds;
  return {
    status: stale ? "DATA_STALE" : "OK",
    ageSeconds,
    stale,
    marketOpen,
    toleranceSeconds,
    reason: stale ? `series lags ${ageSeconds}s > ${toleranceSeconds}s tolerance` : undefined,
  };
}

export interface ProviderCandidate<P extends string = string> {
  provider: P;
  freshness: Freshness;
}

/**
 * Fallback selection when every provider returned stale candles: keep the
 * least stale one (never blend series from different providers).
 */
export function pickLeastStale<T extends ProviderCandidate>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => a.freshness.ageSeconds - b.freshness.ageSeconds)[0];
}
