import type { CandleV2, PivotV2 } from "../schemas/analysis";
import { atr14 } from "../indicators/atr";
import { isIntradayTimeframe } from "../timeframe";
import type { LiquidityKind, LiquidityLevel, LiquiditySide } from "./types";

/**
 * Phase 6 canonical liquidity detection.
 *
 * Levels enumerated:
 *  - SWING_HIGH / SWING_LOW         (only CONFIRMED pivots)
 *  - EQH / EQL                      (only CONFIRMED pivots, clustered within tol)
 *  - PDH / PDL                      (previous UTC day extremes)
 *  - PWH / PWL                      (previous ISO week extremes)
 *  - ASIA_HIGH / ASIA_LOW           (00:00–07:00 UTC of current day, intraday TF only)
 *  - SESSION_HIGH / SESSION_LOW     (current UTC day extremes so far, intraday TF only, PROVISIONAL)
 *
 * State machine (per level), evaluated in this order on every candle after creation:
 *   ACTIVE     — price has not interacted with the level.
 *   SWEPT      — wick crossed the level BUT the candle closed back on the prior side
 *                (true stop hunt / raid).
 *   BROKEN     — candle closed beyond the level (clean break / breakout). Terminal.
 *   MITIGATED  — after a SWEPT state, price retraces through the level
 *                (close on the opposite side of the sweep). Terminal.
 *
 * In-candle classification: when the same candle both wicks past AND closes beyond,
 * we classify as BROKEN (not SWEPT) — the rejection never materialised.
 *
 * Timeframe awareness: ASIA_*, SESSION_* and intraday-only constructs are skipped
 * when the timeframe is daily or higher (a daily 00:00 UTC candle covers the full
 * 24h and cannot be classified as "Asia session").
 */

const DEFAULT_EQ_ATR_TOL = 0.25; // |Δprice| <= 0.25 * ATR considered "equal"
const DEFAULT_EQ_REL_TOL = 0.0015; // 15 bps fallback when ATR is unavailable

const isIntraday = isIntradayTimeframe;

function strengthOf(touches: number, recencyBars: number, totalBars: number): number {
  const touchScore = Math.min(50, touches * 15);
  const recency = Math.max(0, 1 - recencyBars / Math.max(1, totalBars));
  return Math.round(touchScore + recency * 50);
}

function utcDayKey(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** ISO week key (year-week) for grouping previous-week extremes. */
function utcWeekKey(t: number): string {
  const d = new Date(t * 1000);
  // ISO week: Thursday in the current week decides the year.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${week}`;
}

function isAsiaSession(t: number): boolean {
  const h = new Date(t * 1000).getUTCHours();
  return h >= 0 && h < 7;
}

function applyStateMachine(
  level: LiquidityLevel,
  candles: ReadonlyArray<CandleV2>,
  fromIndex: number,
): void {
  for (let k = fromIndex + 1; k < candles.length; k++) {
    const c = candles[k];
    if (level.state === "ACTIVE") {
      if (level.side === "BSL") {
        const wickPast = c.high > level.price;
        const closedBeyond = c.close > level.price;
        if (closedBeyond) {
          // Clean breakout: never enters SWEPT.
          level.state = "BROKEN";
          level.brokenAtIndex = k;
          level.brokenAtTime = c.time;
          return;
        }
        if (wickPast) {
          // Wick past + close back on prior side → genuine stop-hunt.
          level.state = "SWEPT";
          level.sweptAtIndex = k;
          level.sweptAtTime = c.time;
        }
      } else {
        const wickPast = c.low < level.price;
        const closedBeyond = c.close < level.price;
        if (closedBeyond) {
          level.state = "BROKEN";
          level.brokenAtIndex = k;
          level.brokenAtTime = c.time;
          return;
        }
        if (wickPast) {
          level.state = "SWEPT";
          level.sweptAtIndex = k;
          level.sweptAtTime = c.time;
        }
      }
    } else if (level.state === "SWEPT") {
      const consumedHigh = level.side === "BSL" && c.close < level.price;
      const consumedLow = level.side === "SSL" && c.close > level.price;
      if (consumedHigh || consumedLow) {
        level.state = "MITIGATED";
        return;
      }
    }
  }
}

function pushLevel(
  out: LiquidityLevel[],
  base: Omit<LiquidityLevel, "state" | "sweptAtIndex" | "sweptAtTime" | "brokenAtIndex" | "brokenAtTime" | "strength" | "provisional"> & { strength: number; provisional?: boolean },
  candles: ReadonlyArray<CandleV2>,
  fromIndex: number,
): void {
  const lvl: LiquidityLevel = {
    ...base,
    state: "ACTIVE",
    sweptAtIndex: null,
    sweptAtTime: null,
    brokenAtIndex: null,
    brokenAtTime: null,
    provisional: base.provisional ?? false,
  };
  applyStateMachine(lvl, candles, fromIndex);
  out.push(lvl);
}

export interface DetectLiquidityOptions {
  /** Cluster tolerance for equal highs/lows expressed in ATR multiples. */
  eqAtrTolerance?: number;
  /** Fallback relative tolerance when ATR is unavailable. */
  eqRelTolerance?: number;
  /** Emit individual swing-high / swing-low levels (defaults to true). */
  emitSwings?: boolean;
  /** When true, only MAJOR pivots feed swing-high/low levels (defaults to false). */
  majorOnly?: boolean;
  /**
   * Timeframe of the candle series (e.g. "1m", "1h", "4h", "1d", "1w").
   * When the timeframe is daily or higher, intraday-only constructs
   * (ASIA_*, SESSION_*) are NOT emitted.
   */
  timeframe?: string;
}

export function detectLiquidity(
  pivots: ReadonlyArray<PivotV2>,
  candles: ReadonlyArray<CandleV2>,
  opts: DetectLiquidityOptions = {},
): LiquidityLevel[] {
  const atrTol = opts.eqAtrTolerance ?? DEFAULT_EQ_ATR_TOL;
  const relTol = opts.eqRelTolerance ?? DEFAULT_EQ_REL_TOL;
  const emitSwings = opts.emitSwings ?? true;
  const out: LiquidityLevel[] = [];
  if (candles.length === 0) return out;
  const totalBars = candles.length;
  const atrSeries = atr14(candles);

  /** Equality test: |a.price - b.price| <= ATR(at later pivot) * atrTol; rel fallback otherwise. */
  const equalPrice = (a: PivotV2, b: PivotV2): boolean => {
    const refAtr = atrSeries[Math.max(a.index, b.index)];
    if (Number.isFinite(refAtr) && refAtr > 0) {
      return Math.abs(a.price - b.price) <= refAtr * atrTol;
    }
    return Math.abs(a.price - b.price) / Math.max(a.price, 1) <= relTol;
  };

  // EQH/EQL must NEVER be built from provisional pivots — they would vanish on
  // the next bar and corrupt the liquidity map.
  const highs = pivots.filter((p) => p.confirmed && p.type === "HIGH");
  const lows = pivots.filter((p) => p.confirmed && p.type === "LOW");

  // --- Equal highs / equal lows clusters ---
  const cluster = (xs: PivotV2[], side: LiquiditySide, kind: LiquidityKind) => {
    const used = new Set<number>();
    for (let i = 0; i < xs.length; i++) {
      if (used.has(i)) continue;
      const ref = xs[i];
      const members: PivotV2[] = [ref];
      for (let j = i + 1; j < xs.length; j++) {
        if (used.has(j)) continue;
        if (equalPrice(ref, xs[j])) {
          members.push(xs[j]);
          used.add(j);
        }
      }
      if (members.length >= 2) {
        used.add(i);
        const last = members[members.length - 1];
        const price = members.reduce((s, m) => s + m.price, 0) / members.length;
        pushLevel(out, {
          id: `liq-${kind}-${ref.index}`,
          side, kind,
          price,
          time: last.time,
          originIndices: members.map((m) => m.index),
          touches: members.length,
          strength: strengthOf(members.length, totalBars - last.index, totalBars),
        }, candles, last.index);
      }
    }
  };
  cluster(highs, "BSL", "EQH");
  cluster(lows, "SSL", "EQL");

  // --- Individual swing highs / lows (only confirmed pivots, not already in cluster) ---
  if (emitSwings) {
    const clusteredIdx = new Set(out.flatMap((l) => l.originIndices));
    for (const p of pivots) {
      if (!p.confirmed) continue;
      if (opts.majorOnly && p.strength !== "MAJOR") continue;
      if (clusteredIdx.has(p.index)) continue;
      const side: LiquiditySide = p.type === "HIGH" ? "BSL" : "SSL";
      const kind: LiquidityKind = p.type === "HIGH" ? "SWING_HIGH" : "SWING_LOW";
      pushLevel(out, {
        id: `liq-${kind}-${p.index}`,
        side, kind,
        price: p.price,
        time: p.time,
        originIndices: [p.index],
        touches: 1,
        strength: strengthOf(1, totalBars - p.index, totalBars),
      }, candles, p.index);
    }
  }

  // --- Day / week extremes ---
  const intraday = isIntraday(opts.timeframe);
  const last = candles[candles.length - 1];
  const lastDayKey = utcDayKey(last.time);
  const lastWeekKey = utcWeekKey(last.time);
  const dayBuckets = new Map<string, { hi: CandleV2; lo: CandleV2 }>();
  const weekBuckets = new Map<string, { hi: CandleV2; lo: CandleV2 }>();
  for (const c of candles) {
    const dk = utcDayKey(c.time);
    const db = dayBuckets.get(dk);
    if (!db) dayBuckets.set(dk, { hi: c, lo: c });
    else {
      if (c.high > db.hi.high) db.hi = c;
      if (c.low < db.lo.low) db.lo = c;
    }
    const wk = utcWeekKey(c.time);
    const wb = weekBuckets.get(wk);
    if (!wb) weekBuckets.set(wk, { hi: c, lo: c });
    else {
      if (c.high > wb.hi.high) wb.hi = c;
      if (c.low < wb.lo.low) wb.lo = c;
    }
  }
  const days = Array.from(dayBuckets.entries()).sort((a, b) => a[1].hi.time - b[1].hi.time);
  const lastDayIdx = days.findIndex(([k]) => k === lastDayKey);
  if (lastDayIdx > 0) {
    const [, prev] = days[lastDayIdx - 1];
    pushLevel(out, {
      id: `liq-PDH-${prev.hi.index}`,
      side: "BSL", kind: "PDH",
      price: prev.hi.high, time: prev.hi.time,
      originIndices: [prev.hi.index], touches: 1,
      strength: strengthOf(2, totalBars - prev.hi.index, totalBars),
    }, candles, prev.hi.index);
    pushLevel(out, {
      id: `liq-PDL-${prev.lo.index}`,
      side: "SSL", kind: "PDL",
      price: prev.lo.low, time: prev.lo.time,
      originIndices: [prev.lo.index], touches: 1,
      strength: strengthOf(2, totalBars - prev.lo.index, totalBars),
    }, candles, prev.lo.index);
  }
  const weeks = Array.from(weekBuckets.entries()).sort((a, b) => a[1].hi.time - b[1].hi.time);
  const lastWeekIdx = weeks.findIndex(([k]) => k === lastWeekKey);
  if (lastWeekIdx > 0) {
    const [, prev] = weeks[lastWeekIdx - 1];
    pushLevel(out, {
      id: `liq-PWH-${prev.hi.index}`,
      side: "BSL", kind: "PWH",
      price: prev.hi.high, time: prev.hi.time,
      originIndices: [prev.hi.index], touches: 1,
      strength: strengthOf(3, totalBars - prev.hi.index, totalBars),
    }, candles, prev.hi.index);
    pushLevel(out, {
      id: `liq-PWL-${prev.lo.index}`,
      side: "SSL", kind: "PWL",
      price: prev.lo.low, time: prev.lo.time,
      originIndices: [prev.lo.index], touches: 1,
      strength: strengthOf(3, totalBars - prev.lo.index, totalBars),
    }, candles, prev.lo.index);
  }
  if (intraday && lastDayIdx >= 0) {
    const [, cur] = days[lastDayIdx];
    pushLevel(out, {
      id: `liq-SH-${cur.hi.index}`,
      side: "BSL", kind: "SESSION_HIGH",
      price: cur.hi.high, time: cur.hi.time,
      originIndices: [cur.hi.index], touches: 1,
      strength: strengthOf(1, totalBars - cur.hi.index, totalBars),
      provisional: true, // current session extremes can move on the next bar
    }, candles, cur.hi.index);
    pushLevel(out, {
      id: `liq-SL-${cur.lo.index}`,
      side: "SSL", kind: "SESSION_LOW",
      price: cur.lo.low, time: cur.lo.time,
      originIndices: [cur.lo.index], touches: 1,
      strength: strengthOf(1, totalBars - cur.lo.index, totalBars),
      provisional: true,
    }, candles, cur.lo.index);
  }

  // --- Asia session of the last UTC day (intraday only) ---
  const asiaCandles = intraday
    ? candles.filter((c) => utcDayKey(c.time) === lastDayKey && isAsiaSession(c.time))
    : [];
  if (asiaCandles.length > 0) {
    let aHi = asiaCandles[0], aLo = asiaCandles[0];
    for (const c of asiaCandles) { if (c.high > aHi.high) aHi = c; if (c.low < aLo.low) aLo = c; }
    pushLevel(out, {
      id: `liq-AH-${aHi.index}`,
      side: "BSL", kind: "ASIA_HIGH",
      price: aHi.high, time: aHi.time,
      originIndices: [aHi.index], touches: 1,
      strength: strengthOf(2, totalBars - aHi.index, totalBars),
      // Asia range is provisional while the Asia session is still open.
      provisional: utcDayKey(last.time) === lastDayKey && isAsiaSession(last.time),
    }, candles, aHi.index);
    pushLevel(out, {
      id: `liq-AL-${aLo.index}`,
      side: "SSL", kind: "ASIA_LOW",
      price: aLo.low, time: aLo.time,
      originIndices: [aLo.index], touches: 1,
      strength: strengthOf(2, totalBars - aLo.index, totalBars),
      provisional: utcDayKey(last.time) === lastDayKey && isAsiaSession(last.time),
    }, candles, aLo.index);
  }

  return out;
}
