/**
 * Client-side cache + in-flight request deduplication for chart data.
 *
 * Keyed by `symbol|timeframe|bars|kind` so switching Operational ↔ Diagnostic,
 * toggling layers, or navigating back to a chart never refetches OHLC.
 */

interface Entry<T> {
  value?: T;
  at: number;
  promise?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();

export const DEFAULT_TTL_MS = 60_000;

export function chartKey(parts: (string | number | boolean | undefined)[]): string {
  return parts.map((p) => String(p ?? "")).join("|");
}

/**
 * Resolve `key` from cache when fresh; otherwise run `fn` once and share the
 * same promise with every concurrent caller (dedupe).
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  const now = Date.now();
  if (hit) {
    if (hit.promise) return hit.promise;
    if (hit.value !== undefined && now - hit.at < ttlMs) return hit.value;
  }
  const promise = fn()
    .then((value) => {
      store.set(key, { value, at: Date.now() });
      return value;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });
  store.set(key, { at: now, promise });
  return promise;
}

export function peekCache<T>(key: string): T | undefined {
  const hit = store.get(key) as Entry<T> | undefined;
  return hit?.value;
}

export function invalidate(prefix: string): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

/** Simple dev timing collector. */
export class Timings {
  private marks: Record<string, number> = {};
  private t0 = performance.now();
  mark(name: string, from?: number): void {
    this.marks[name] = Math.round(performance.now() - (from ?? this.t0));
  }
  measure<T>(name: string, fn: () => T): T {
    const s = performance.now();
    const out = fn();
    this.marks[name] = Math.round(performance.now() - s);
    return out;
  }
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const s = performance.now();
    const out = await fn();
    this.marks[name] = Math.round(performance.now() - s);
    return out;
  }
  snapshot(): Record<string, number> {
    return { ...this.marks, totalMs: Math.round(performance.now() - this.t0) };
  }
}
