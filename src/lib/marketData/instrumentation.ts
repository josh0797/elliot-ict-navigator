/** Structured, low-noise telemetry for the market-data layer. */

export interface DataEvent {
  requestId: string;
  provider: string;
  symbol: string;
  timeframe: string;
  limit: number;
  cache?: "HIT" | "MISS" | "COALESCED";
  outcome: "served" | "skipped" | "empty" | "stale" | "error";
  reason?: string;
  ms?: number;
  candles?: number;
}

export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function logDataEvent(e: DataEvent): void {
  const parts = [
    `[mkt ${e.requestId}]`,
    e.provider,
    `${e.symbol}|${e.timeframe}|${e.limit}`,
    e.cache ? `cache=${e.cache}` : null,
    `outcome=${e.outcome}`,
    e.candles !== undefined ? `candles=${e.candles}` : null,
    e.ms !== undefined ? `${e.ms}ms` : null,
    e.reason ? `reason=${e.reason}` : null,
  ].filter(Boolean);
  console.info(parts.join(" "));
}
