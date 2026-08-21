/**
 * Temporal anchoring for chart overlays.
 *
 * Elliott (`ElliottWaveDTO`) and ICT (sweeps, structure) carry BOTH a timestamp
 * and a candle `index`. The index is relative to the ANALYSIS snapshot. Since
 * the chart can render a deeper, decoupled VISUAL series, the same index points
 * at a different candle there — which used to shift labels/lines onto the wrong
 * bars. Timestamp identity is therefore the only source of truth; `index` is
 * kept as a diagnostic and is only trusted when the analysis series is known.
 *
 * Pure module: no chart library, no engine rules. Safe to unit test.
 */

export interface AnchorSeries {
  /** Ascending, de-duplicated candle times (seconds). */
  times: number[];
  set: Set<number>;
  /** Median bar spacing in seconds (0 when undeterminable). */
  spacing: number;
}

export type AnchorMode = "exact" | "snapped" | "unresolved";

export interface AnchorResolution {
  /** Candle time (seconds) to render at, or null when unresolvable. */
  time: number | null;
  mode: AnchorMode;
  /** Absolute distance in seconds between the requested and rendered time. */
  drift: number;
  reason?: string;
}

export interface AnchorInput {
  /** ISO string or unix seconds/ms. */
  time?: string | number | null;
  /** Index into the ANALYSIS series (diagnostic / resolved via analysisTimes). */
  index?: number | null;
}

/** Snapping tolerance = `TOLERANCE_BARS` × median bar spacing. */
export const TOLERANCE_BARS = 1;

export function toSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Heuristic: values beyond year 33658 in seconds are milliseconds.
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export function buildAnchorSeries(candles: readonly { time: number }[]): AnchorSeries {
  const set = new Set<number>();
  for (const c of candles) {
    if (typeof c.time === "number" && Number.isFinite(c.time) && c.time > 0) set.add(c.time);
  }
  const times = [...set].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) diffs.push(times[i] - times[i - 1]);
  diffs.sort((a, b) => a - b);
  const spacing = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
  return { times, set, spacing };
}

/**
 * Resolve an overlay anchor against the rendered series.
 *
 * `analysisTimes` (the timestamps of the series the overlay indices were
 * computed against) turns `index` into a real timestamp; without it the index
 * is ignored entirely unless it provably belongs to the rendered series.
 */
export function resolveAnchor(
  series: AnchorSeries,
  input: AnchorInput,
  opts?: { analysisTimes?: readonly number[]; toleranceBars?: number },
): AnchorResolution {
  if (series.times.length === 0) {
    return { time: null, mode: "unresolved", drift: 0, reason: "empty-series" };
  }
  const analysisTimes = opts?.analysisTimes;
  const idx = typeof input.index === "number" && input.index >= 0 ? input.index : null;

  let target: number | null = null;
  if (analysisTimes && idx !== null && idx < analysisTimes.length) {
    target = toSeconds(analysisTimes[idx]);
  }
  if (target === null) target = toSeconds(input.time ?? null);
  if (target === null && analysisTimes === undefined && idx !== null && idx < series.times.length) {
    // Last resort: no timestamp at all. Only safe when the caller did not
    // declare a separate analysis series (i.e. index and chart share a series).
    target = series.times[idx];
  }
  if (target === null) {
    return { time: null, mode: "unresolved", drift: 0, reason: "no-timestamp" };
  }

  if (series.set.has(target)) return { time: target, mode: "exact", drift: 0 };

  const { times } = series;
  if (target < times[0] || target > times[times.length - 1]) {
    return { time: null, mode: "unresolved", drift: 0, reason: "outside-series" };
  }
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= target) lo = mid;
    else hi = mid;
  }
  const nearest = target - times[lo] <= times[hi] - target ? times[lo] : times[hi];
  const drift = Math.abs(nearest - target);
  const tolerance = series.spacing * (opts?.toleranceBars ?? TOLERANCE_BARS);
  if (tolerance <= 0 || drift > tolerance) {
    return { time: null, mode: "unresolved", drift, reason: "out-of-tolerance" };
  }
  return { time: nearest, mode: "snapped", drift };
}

export interface AnchorIssue {
  kind: string;
  label: string;
  requestedTime: string | number | null | undefined;
  index: number | null | undefined;
  reason: string;
  drift: number;
}
