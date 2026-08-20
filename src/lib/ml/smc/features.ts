/**
 * SMC_M30 feature schema v1 — pure, deterministic, entry-time only.
 *
 * Rules:
 *  - No RSI / EMA / Elliott inputs in v1 (ablation-only, later).
 *  - Every builder reads ONLY `SmcFeatureContext`; the caller is responsible for
 *    truncating all series to the feature timestamp (no look-ahead).
 *  - The vector order is frozen by `SMC_FEATURE_NAMES`. Append-only; any
 *    reorder requires a new schema version.
 *  - All outputs are finite (NaN/Infinity are coerced to 0 and clamped).
 *
 * 41 raw features are emitted; pruning to a compact operative subset happens at
 * training time through ablation, not by silently dropping columns here.
 */
import type { Candle } from "@/lib/marketData/types";
import { londonClock } from "./clock";
import {
  SMC_FEATURE_SCHEMA_VERSION,
  type CandidateDirection,
  type SmcFeatureContext,
  type SmcFeatureResult,
} from "./types";

export const SMC_FEATURE_NAMES = [
  // --- timing / session (9)
  "london_minute_sin",
  "london_minute_cos",
  "minutes_from_m30_norm",
  "in_first_15m_after_m30",
  "exact_m30_boundary",
  "session_asia",
  "session_london_pre",
  "session_london",
  "session_ny_am",
  // --- volatility / price action (9)
  "range_over_atr",
  "range_expansion_over_atr",
  "atr_fast_slow_ratio",
  "body_over_range",
  "upper_wick_over_range",
  "lower_wick_over_range",
  "velocity3_over_atr",
  "velocity5_over_atr",
  "acceleration_over_atr",
  // --- liquidity / SMC (14)
  "sweep_bsl_recent",
  "sweep_ssl_recent",
  "sweep_quality_norm",
  "sweep_close_back",
  "bars_since_sweep_norm",
  "swing_distance_over_atr",
  "pdh_distance_over_atr",
  "pdl_distance_over_atr",
  "pdh_swept",
  "pdl_swept",
  "asia_high_distance_over_atr",
  "asia_low_distance_over_atr",
  "asia_high_swept",
  "asia_low_swept",
  // --- structure / imbalance (9)
  "structure_direction_relative",
  "bars_since_structure_norm",
  "fvg_fresh",
  "fvg_size_over_atr",
  "fvg_distance_over_atr",
  "ob_fresh_or_touched",
  "ob_distance_over_atr",
  "pd_position",
  "pd_aligned",
] as const;

export type SmcFeatureName = (typeof SMC_FEATURE_NAMES)[number];

export const SMC_FEATURE_COUNT = SMC_FEATURE_NAMES.length;

/** Bars considered "recent" for sweep/structure recency features. */
const RECENT_BARS = 6;
/** Cap for recency normalization (bars). */
const RECENCY_CAP = 20;

function fin(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return fin(a / b);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, n));
}

function bool(b: boolean | undefined): number {
  return b ? 1 : 0;
}

/** Latest finite ATR value from an aligned series or a scalar. */
export function resolveAtrValue(atr: number[] | number): number {
  if (typeof atr === "number") return Number.isFinite(atr) && atr > 0 ? atr : 0;
  for (let i = atr.length - 1; i >= 0; i--) {
    const v = atr[i];
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

/** Mean ATR over the last `n` finite values (slow leg of the fast/slow ratio). */
function atrMean(atr: number[] | number, n: number): number {
  if (typeof atr === "number") return Number.isFinite(atr) && atr > 0 ? atr : 0;
  let sum = 0;
  let count = 0;
  for (let i = atr.length - 1; i >= 0 && count < n; i--) {
    const v = atr[i];
    if (Number.isFinite(v) && v > 0) {
      sum += v;
      count++;
    }
  }
  return count ? sum / count : 0;
}

function rangeOver(candles: Candle[], bars: number): number {
  const slice = candles.slice(Math.max(0, candles.length - bars));
  if (!slice.length) return 0;
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of slice) {
    if (Number.isFinite(c.high)) hi = Math.max(hi, c.high);
    if (Number.isFinite(c.low)) lo = Math.min(lo, c.low);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return 0;
  return hi - lo;
}

function closeDelta(candles: Candle[], bars: number): number {
  if (candles.length < 2) return 0;
  const last = candles[candles.length - 1];
  const ref = candles[Math.max(0, candles.length - 1 - bars)];
  return fin(last.close - ref.close);
}

/** Nearest recent swing (fractal high/low over `RECENT_BARS*2`) distance. */
function nearestSwingDistance(candles: Candle[]): number {
  const n = candles.length;
  if (n < 5) return 0;
  const close = candles[n - 1].close;
  let best = Infinity;
  const from = Math.max(2, n - RECENT_BARS * 2);
  for (let i = from; i < n - 2; i++) {
    const c = candles[i];
    const isHigh = c.high > candles[i - 1].high && c.high > candles[i + 1].high;
    const isLow = c.low < candles[i - 1].low && c.low < candles[i + 1].low;
    if (isHigh) best = Math.min(best, Math.abs(close - c.high));
    if (isLow) best = Math.min(best, Math.abs(close - c.low));
  }
  return Number.isFinite(best) ? best : 0;
}

function indexOfTime(candles: Candle[], time: number): number {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time <= time) return i;
  }
  return -1;
}

/**
 * Build the frozen SMC v1 feature vector for a candidate.
 * Pure: identical inputs always yield an identical vector.
 */
export function buildSmcFeatures(ctx: SmcFeatureContext): SmcFeatureResult {
  const candles = ctx.candles ?? [];
  const n = candles.length;
  const anchor: Candle | null = n ? candles[n - 1] : null;
  const atTime = Number.isFinite(ctx.atTime) ? ctx.atTime : (anchor?.time ?? 0);
  const direction: CandidateDirection = ctx.direction === "short" ? "short" : "long";
  const dirSign = direction === "long" ? 1 : -1;
  const clock = londonClock(atTime);

  const atr = resolveAtrValue(ctx.atr);
  const atrSlow = atrMean(ctx.atr, 20);
  const close = anchor ? fin(anchor.close) : 0;

  const named: Record<string, number> = {};
  const put = (k: SmcFeatureName, v: number) => {
    named[k] = fin(v);
  };

  /* ---------- timing / session ---------- */
  const minuteAngle = (2 * Math.PI * clock.minuteOfDay) / 1440;
  put("london_minute_sin", Math.sin(minuteAngle));
  put("london_minute_cos", Math.cos(minuteAngle));
  put("minutes_from_m30_norm", clock.minutesFromM30Boundary / 29);
  put("in_first_15m_after_m30", bool(clock.inFirst15mAfterM30));
  put("exact_m30_boundary", bool(clock.exactM30Boundary));
  put("session_asia", bool(clock.session === "ASIA"));
  put("session_london_pre", bool(clock.session === "LONDON_PRE"));
  put("session_london", bool(clock.session === "LONDON"));
  put("session_ny_am", bool(clock.session === "NY_AM"));

  /* ---------- volatility / price action ---------- */
  const barRange = anchor ? Math.max(0, fin(anchor.high - anchor.low)) : 0;
  const body = anchor ? Math.abs(fin(anchor.close - anchor.open)) : 0;
  const upperWick = anchor ? Math.max(0, fin(anchor.high - Math.max(anchor.open, anchor.close))) : 0;
  const lowerWick = anchor ? Math.max(0, fin(Math.min(anchor.open, anchor.close) - anchor.low)) : 0;
  const range3 = rangeOver(candles, 3);
  const vel3 = closeDelta(candles, 3);
  const vel5 = closeDelta(candles, 5);
  const prevVel3 = closeDelta(candles.slice(0, Math.max(0, n - 3)), 3);

  put("range_over_atr", clamp(safeDiv(barRange, atr), 0, 10));
  put("range_expansion_over_atr", clamp(safeDiv(range3, atr), 0, 20));
  put("atr_fast_slow_ratio", clamp(safeDiv(atr, atrSlow), 0, 5));
  put("body_over_range", clamp(safeDiv(body, barRange), 0, 1));
  put("upper_wick_over_range", clamp(safeDiv(upperWick, barRange), 0, 1));
  put("lower_wick_over_range", clamp(safeDiv(lowerWick, barRange), 0, 1));
  put("velocity3_over_atr", clamp(safeDiv(vel3 * dirSign, atr), -10, 10));
  put("velocity5_over_atr", clamp(safeDiv(vel5 * dirSign, atr), -10, 10));
  put("acceleration_over_atr", clamp(safeDiv((vel3 - prevVel3) * dirSign, atr), -10, 10));

  /* ---------- liquidity ---------- */
  const anchorIndex = n - 1;
  const sweeps = (ctx.sweeps ?? []).filter((s) => Number.isFinite(s.time) && s.time <= atTime);
  const recentSweeps = sweeps.filter((s) => {
    const idx = Number.isFinite(s.index) ? s.index : indexOfTime(candles, s.time);
    return anchorIndex - idx <= RECENT_BARS && anchorIndex - idx >= 0;
  });
  const latestSweep = sweeps.length
    ? sweeps.reduce((a, b) => (b.time >= a.time ? b : a))
    : null;
  const latestSweepIdx = latestSweep
    ? Number.isFinite(latestSweep.index)
      ? latestSweep.index
      : indexOfTime(candles, latestSweep.time)
    : -1;

  put("sweep_bsl_recent", bool(recentSweeps.some((s) => s.side === "BSL")));
  put("sweep_ssl_recent", bool(recentSweeps.some((s) => s.side === "SSL")));
  put("sweep_quality_norm", latestSweep ? clamp(fin(latestSweep.quality) / 100, 0, 1) : 0);
  put("sweep_close_back", bool(latestSweep?.closeBack));
  put(
    "bars_since_sweep_norm",
    latestSweepIdx >= 0 ? clamp((anchorIndex - latestSweepIdx) / RECENCY_CAP, 0, 1) : 1,
  );
  put("swing_distance_over_atr", clamp(safeDiv(nearestSwingDistance(candles), atr), 0, 20));

  const pd = ctx.previousDay ?? null;
  put("pdh_distance_over_atr", pd ? clamp(safeDiv(pd.high - close, atr), -20, 20) : 0);
  put("pdl_distance_over_atr", pd ? clamp(safeDiv(close - pd.low, atr), -20, 20) : 0);
  const levels = (ctx.liquidity ?? []).filter((l) => Number.isFinite(l.time) && l.time <= atTime);
  const sweptKind = (kinds: string[]) =>
    bool(levels.some((l) => kinds.includes(l.kind) && (l.state === "SWEPT" || l.state === "BROKEN")));
  put("pdh_swept", sweptKind(["PDH"]));
  put("pdl_swept", sweptKind(["PDL"]));

  const asia = ctx.asiaRange ?? null;
  put("asia_high_distance_over_atr", asia ? clamp(safeDiv(asia.high - close, atr), -20, 20) : 0);
  put("asia_low_distance_over_atr", asia ? clamp(safeDiv(close - asia.low, atr), -20, 20) : 0);
  put("asia_high_swept", asia ? bool(asia.sweptHigh) : sweptKind(["ASIA_HIGH"]));
  put("asia_low_swept", asia ? bool(asia.sweptLow) : sweptKind(["ASIA_LOW"]));

  /* ---------- structure / imbalance ---------- */
  const events = (ctx.structure ?? []).filter(
    (e) => e.state !== "FAILED" && Number.isFinite(e.time) && e.time <= atTime,
  );
  const latestEvent = events.length ? events.reduce((a, b) => (b.time >= a.time ? b : a)) : null;
  const latestEventIdx = latestEvent
    ? Number.isFinite(latestEvent.index)
      ? latestEvent.index
      : indexOfTime(candles, latestEvent.time)
    : -1;
  put(
    "structure_direction_relative",
    latestEvent ? (latestEvent.direction === direction ? 1 : -1) : 0,
  );
  put(
    "bars_since_structure_norm",
    latestEventIdx >= 0 ? clamp((anchorIndex - latestEventIdx) / RECENCY_CAP, 0, 1) : 1,
  );

  const wantedFvg = direction === "long" ? "bullish" : "bearish";
  const fvgs = (ctx.fvgs ?? []).filter(
    (f) => f.type === wantedFvg && !f.mitigated && Number.isFinite(f.startTime) && f.startTime <= atTime,
  );
  const fvg = fvgs.length ? fvgs.reduce((a, b) => (b.startTime >= a.startTime ? b : a)) : null;
  put("fvg_fresh", bool(!!fvg));
  put("fvg_size_over_atr", fvg ? clamp(safeDiv(fvg.top - fvg.bottom, atr), 0, 10) : 0);
  put(
    "fvg_distance_over_atr",
    fvg
      ? clamp(
          safeDiv(
            close > fvg.top ? close - fvg.top : close < fvg.bottom ? fvg.bottom - close : 0,
            atr,
          ),
          0,
          20,
        )
      : 0,
  );

  const wantedOb = direction === "long" ? "BULLISH" : "BEARISH";
  const obs = (ctx.orderBlocks ?? []).filter(
    (o) =>
      o.type === wantedOb &&
      (o.state === "FRESH" || o.state === "TOUCHED") &&
      Number.isFinite(o.originTime) &&
      o.originTime <= atTime,
  );
  const ob = obs.length ? obs.reduce((a, b) => (b.originTime >= a.originTime ? b : a)) : null;
  put("ob_fresh_or_touched", bool(!!ob));
  put(
    "ob_distance_over_atr",
    ob
      ? clamp(
          safeDiv(close > ob.top ? close - ob.top : close < ob.bottom ? ob.bottom - close : 0, atr),
          0,
          20,
        )
      : 0,
  );

  const pdArr = ctx.pdArray ?? null;
  put("pd_position", pdArr ? clamp(fin(pdArr.position), 0, 1) : 0.5);
  put(
    "pd_aligned",
    pdArr
      ? bool(
          (direction === "long" && pdArr.zone === "DISCOUNT") ||
            (direction === "short" && pdArr.zone === "PREMIUM"),
        )
      : 0,
  );

  const vector = SMC_FEATURE_NAMES.map((k) => fin(named[k] ?? 0));

  return {
    schemaVersion: SMC_FEATURE_SCHEMA_VERSION,
    featureNames: SMC_FEATURE_NAMES,
    vector,
    named,
    clock,
    atTime,
    direction,
  };
}
