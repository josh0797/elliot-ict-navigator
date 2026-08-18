/**
 * Multi-timeframe coherence.
 *
 * Two independent readings coexist in every snapshot:
 *   A. MACRO / CONTEXT count — runs on the context timeframe (never on the
 *      execution timeframe). Switching 1h ↔ 4h must NOT change it.
 *   B. LOCAL / EXECUTION subcount — runs on the execution timeframe and is
 *      free to change on every resolution switch.
 *
 * The macro scenario identity is derived from the context timeframe, the
 * shared `asOf` bucket and the macro pivot anchors (timestamp + price, never
 * array indices), so two different execution timeframes that share the same
 * context timeframe and the same `asOf` produce the SAME `scenarioId`.
 */

import { normalizeTimeframe } from "./timeframe";

const SECONDS: Record<string, number> = {
  "1m": 60, "2m": 120, "3m": 180, "5m": 300, "10m": 600, "15m": 900, "30m": 1800, "45m": 2700,
  "1h": 3600, "2h": 7200, "3h": 10800, "4h": 14400, "6h": 21600, "8h": 28800, "12h": 43200,
  "1d": 86400, "1w": 604800, "1M": 2592000,
};

/** Configurable execution → context hierarchy. */
export const CONTEXT_HIERARCHY: Record<string, string> = {
  "1m": "15m",
  "5m": "1h",
  "15m": "4h",
  "30m": "4h",
  "1h": "1d",
  "2h": "1d",
  "4h": "1d",
  "1d": "1w",
  "1w": "1w",
};

export function timeframeSeconds(tf: string): number {
  return SECONDS[normalizeTimeframe(tf)] ?? 3600;
}

/** Context (macro) timeframe for an execution timeframe. */
export function contextTimeframeFor(tf: string): string {
  const key = normalizeTimeframe(tf);
  return CONTEXT_HIERARCHY[key] ?? "1d";
}

/**
 * Latest bucket boundary that is fully CLOSED at `asOf` for `tf`.
 * A bar whose bucket contains `asOf` is still open and must never modify a count.
 */
export function lastClosedBucket(tf: string, asOfSeconds: number): number {
  const sec = timeframeSeconds(tf);
  return Math.floor(asOfSeconds / sec) * sec - sec;
}

/** Keep only candles whose bucket closed at or before `asOf`. */
export function closedCandlesAsOf<T extends { time: number }>(
  candles: readonly T[],
  tf: string,
  asOfSeconds: number,
): T[] {
  const cutoff = lastClosedBucket(tf, asOfSeconds);
  return candles.filter((c) => c.time <= cutoff);
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface MacroAnchor {
  time: number;
  price: number;
  label: string;
}

/**
 * Deterministic macro scenario identity. Depends ONLY on context-timeframe
 * facts: never on the execution timeframe, bars count or visual resolution.
 */
export function macroScenarioId(input: {
  symbol: string;
  contextTimeframe: string;
  asOf: number;
  pattern: string;
  bias: string;
  anchors: readonly MacroAnchor[];
}): string {
  const ctxTf = normalizeTimeframe(input.contextTimeframe);
  const bucket = lastClosedBucket(ctxTf, input.asOf);
  const anchors = input.anchors
    .map((a) => `${a.label}@${a.time}:${a.price.toPrecision(8)}`)
    .join(",");
  return `${input.symbol}|${ctxTf}|${input.pattern}|${input.bias}|${hash(`${bucket}|${anchors}`)}`;
}