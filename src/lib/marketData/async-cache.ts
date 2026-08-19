/**
 * Generic async cache with request coalescing — pure module (no I/O), so it is
 * unit-testable and safe to import from `*.functions.ts` wrappers.
 *
 * Two independent guarantees:
 *   • COALESCING: N concurrent callers of the same key share ONE in-flight
 *     promise, therefore ONE upstream request.
 *   • TTL: a resolved value is reused until it expires (TTL derived from the
 *     timeframe: intraday bars expire fast, daily bars live much longer).
 */

export type Clock = () => number;

export type CacheOutcome = "HIT" | "MISS" | "COALESCED";

interface Entry<T> {
  value?: T;
  storedAt: number;
  ttlMs: number;
  promise?: Promise<T>;
}

export interface CacheResult<T> {
  value: T;
  outcome: CacheOutcome;
}

export class AsyncCache {
  private store = new Map<string, Entry<unknown>>();

  constructor(private clock: Clock = Date.now) {}

  /** Number of upstream executions is exactly the number of MISS outcomes. */
  async resolve<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<CacheResult<T>> {
    const hit = this.store.get(key) as Entry<T> | undefined;
    const now = this.clock();
    if (hit?.promise) return { value: await hit.promise, outcome: "COALESCED" };
    if (hit && hit.value !== undefined && now - hit.storedAt < hit.ttlMs) {
      return { value: hit.value, outcome: "HIT" };
    }

    const promise = fn().then(
      (value) => {
        this.store.set(key, { value, storedAt: this.clock(), ttlMs });
        return value;
      },
      (err) => {
        this.store.delete(key);
        throw err;
      },
    );
    this.store.set(key, { storedAt: now, ttlMs, promise });
    return { value: await promise, outcome: "MISS" };
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.store.clear();
      return;
    }
    for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
  }

  size(): number {
    return this.store.size;
  }
}

/** Cache key contract required by the audit: provider:symbol:timeframe:limit. */
export function ohlcvKey(parts: {
  provider: string;
  symbol: string;
  timeframe: string;
  limit: number;
}): string {
  return `${parts.provider}:${parts.symbol.toUpperCase()}:${parts.timeframe}:${parts.limit}`;
}

/**
 * TTL per timeframe. A closed 4h candle cannot change for 4h, so re-querying
 * every render is pure waste; the cap keeps intraday responsive.
 */
export function ttlForTimeframe(timeframe: string): number {
  switch (timeframe) {
    case "1m":
    case "1min":
      return 20_000;
    case "5m":
    case "5min":
      return 45_000;
    case "15m":
    case "15min":
      return 90_000;
    case "30m":
    case "30min":
      return 150_000;
    case "1h":
      return 300_000;
    case "4h":
      return 900_000;
    case "1d":
    case "1day":
      return 1_800_000;
    case "1w":
    case "1week":
      return 3_600_000;
    default:
      return 120_000;
  }
}
