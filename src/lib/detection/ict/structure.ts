import type { CandleV2, PivotV2 } from "../schemas/analysis";
import { atr14 } from "../indicators/atr";
import type { LiquiditySweep, StructureEvent, StructureState } from "./types";

/**
 * Phase 7+8 canonical Structure detection.
 *
 * BOS (Break Of Structure): a candle CLOSES beyond a protected MAJOR swing in the
 * direction of the prevailing trend. Wicks alone do not confirm a BOS.
 *
 * CHoCH (Change of Character): the first close beyond a protected MAJOR swing
 * AGAINST the prevailing trend. Optionally enriched with a preceding liquidity
 * sweep on the same side as the prior trend.
 *
 * State machine:
 *   PROVISIONAL — close beyond the level but displacement not yet confirmed.
 *   CONFIRMED   — close beyond + displacement (body >= 1.5 × ATR) or follow-through close.
 *   FAILED      — price re-closes back through the broken level within a short window.
 *
 * Deduplication: each protected pivot can produce at most one structure event.
 * Only MAJOR pivots are eligible as protected swings.
 */

const DISPLACEMENT_ATR = 1.5;
const FAIL_WINDOW = 8;

export interface DetectStructureOptions {
  /** Optional sweep stream — when present, CHoCH gets `precedingSweepId` when applicable. */
  sweeps?: ReadonlyArray<LiquiditySweep>;
}

export function detectStructure(
  pivots: ReadonlyArray<PivotV2>,
  candles: ReadonlyArray<CandleV2> = [],
  opts: DetectStructureOptions = {},
): StructureEvent[] {
  const out: StructureEvent[] = [];
  if (pivots.length < 2) return out;

  const major = pivots.filter((p) => p.strength === "MAJOR" && p.confirmed);
  if (major.length < 2) return out;

  const atrSeries = candles.length ? atr14(candles) : [];
  const sweeps = opts.sweeps ?? [];
  const usedPivot = new Set<string>();
  let trend: "up" | "down" | null = null;

  /** Find the first candle index AFTER the protected pivot that CLOSES beyond `level`. */
  const findBreakClose = (fromIndex: number, level: number, direction: "long" | "short"): number => {
    if (!candles.length) return -1;
    for (let k = fromIndex + 1; k < candles.length; k++) {
      const c = candles[k];
      if (direction === "long" && c.close > level) return k;
      if (direction === "short" && c.close < level) return k;
    }
    return -1;
  };

  /** Did price re-close on the wrong side of the level within FAIL_WINDOW bars? */
  const checkFailed = (breakIndex: number, level: number, direction: "long" | "short"): boolean => {
    if (!candles.length) return false;
    for (let k = breakIndex + 1; k <= Math.min(candles.length - 1, breakIndex + FAIL_WINDOW); k++) {
      const c = candles[k];
      if (direction === "long" && c.close < level) return true;
      if (direction === "short" && c.close > level) return true;
    }
    return false;
  };

  for (let i = 1; i < major.length; i++) {
    const cur = major[i];
    // Find the protected pivot: the most recent prior MAJOR pivot of OPPOSITE type that defines a swing.
    let protectedPivot: PivotV2 | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (major[j].type !== cur.type) { protectedPivot = major[j]; break; }
    }
    if (!protectedPivot) continue;

    // Direction implied by which side cur breaks: a HIGH pivot continues an uptrend break;
    // a LOW pivot continues a downtrend break. Canonical break is of a same-type pivot.
    // Use last same-type prior MAJOR pivot as the "broken" level candidate.
    let sameTypePrev: PivotV2 | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (major[j].type === cur.type) { sameTypePrev = major[j]; break; }
    }
    if (!sameTypePrev || usedPivot.has(sameTypePrev.id)) continue;

    const direction: "long" | "short" = cur.type === "HIGH" ? "long" : "short";
    const isBreak = direction === "long" ? cur.price > sameTypePrev.price : cur.price < sameTypePrev.price;
    if (!isBreak) continue;

    // Confirm via candle close beyond the level (close-based break).
    const breakIndex = candles.length
      ? findBreakClose(sameTypePrev.index, sameTypePrev.price, direction)
      : cur.index;
    if (breakIndex < 0) continue;

    const breakCandle = candles[breakIndex] ?? null;
    const breakPrice = breakCandle?.close ?? cur.price;
    const atrHere = breakCandle && atrSeries[breakIndex] && Number.isFinite(atrSeries[breakIndex])
      ? atrSeries[breakIndex]
      : NaN;
    const closeBeyondAtr = breakCandle && Number.isFinite(atrHere) && atrHere > 0
      ? Math.abs(breakPrice - sameTypePrev.price) / atrHere
      : 0;
    const body = breakCandle ? Math.abs(breakCandle.close - breakCandle.open) : 0;
    const displacement = Number.isFinite(atrHere) && atrHere > 0 && body >= DISPLACEMENT_ATR * atrHere;
    const failed = breakCandle ? checkFailed(breakIndex, sameTypePrev.price, direction) : false;
    let state: StructureState = "PROVISIONAL";
    if (failed) state = "FAILED";
    else if (displacement || closeBeyondAtr >= 1) state = "CONFIRMED";

    const isCounterTrend =
      (trend === "down" && direction === "long") || (trend === "up" && direction === "short");
    const type: "BOS" | "CHoCH" = isCounterTrend ? "CHoCH" : "BOS";

    // CHoCH enrichment: preceding sweep on the side aligned with the prior trend.
    let precedingSweepId: string | undefined;
    if (type === "CHoCH") {
      const wanted = direction === "long" ? "sell_side" : "buy_side";
      const window = candles.length ? Math.max(0, breakIndex - 10) : 0;
      const sweep = [...sweeps]
        .reverse()
        .find((s) => s.type === wanted && s.index >= window && s.index <= breakIndex);
      if (sweep) precedingSweepId = sweep.id;
    }

    usedPivot.add(sameTypePrev.id);
    out.push({
      id: `${type.toLowerCase()}-${breakIndex}-${direction === "long" ? "l" : "s"}`,
      type,
      direction,
      price: sameTypePrev.price,
      time: breakCandle?.time ?? cur.time,
      index: breakIndex,
      state,
      brokenPivotId: sameTypePrev.id,
      brokenSwingId: protectedPivot ? `swing-${protectedPivot.id}-${sameTypePrev.id}` : undefined,
      breakIndex,
      breakPrice,
      closeBeyondAtr,
      displacement,
      displacementId: displacement && breakCandle ? `disp-${breakIndex}` : undefined,
      precedingSweepId,
    });

    if (state !== "FAILED") trend = direction === "long" ? "up" : "down";
  }

  return out;
}
