import type { CandleV2 } from "../schemas/analysis";
import { atr14 } from "../indicators/atr";
import type { FVG, OrderBlock, OBRangePolicy, OBState, StructureEvent } from "./types";

/**
 * Phase 5 Order Block detection.
 *
 * An Order Block is qualified only when it satisfies the canonical chain:
 *   1. Displacement: a strong impulsive candle (body >= DISPLACEMENT_ATR_MULT × ATR).
 *   2. BOS: a Break of Structure aligned with the displacement direction, occurring at or
 *      shortly after the displacement candle.
 *   3. FVG association: a Fair Value Gap created at the displacement window (i-1, i, i+1).
 *   4. The OB itself is the LAST opposite-color candle preceding the displacement.
 *
 * Range policy (configurable, default BODY):
 *   - FULL_CANDLE: [low, high]
 *   - BODY:        [min(open,close), max(open,close)]
 *   - OPEN_TO_LOW: bullish OB = [low, open]; mirrored for bearish
 *   - OPEN_TO_HIGH: bullish OB = [open, high]; mirrored for bearish
 *
 * Lifecycle:
 *   FRESH      → no candle has crossed into the OB range yet.
 *   TOUCHED    → at least one wick reached into the range; mitigationPercent > 0.
 *   MITIGATED  → price has filled ≥ 50% of the range (mitigationPercent ≥ 50).
 *   INVALIDATED → a candle has closed beyond the OB on the opposite side.
 *   BREAKER    → invalidated AND price has later returned to the broken range
 *                (polarity flips: bullish OB → resistance, bearish OB → support).
 */

export const DEFAULT_RANGE_POLICY: OBRangePolicy = "BODY";
const DISPLACEMENT_ATR_MULT = 1.5;
const BOS_WINDOW = 8; // bars within which a BOS must occur after the displacement
const OB_LOOKBACK = 6; // bars before displacement to scan for the opposite candle
const VOLUME_LOOKBACK = 20;
const VOLUME_MULT = 1.5;

function rangeOf(candle: CandleV2, kind: "BULLISH" | "BEARISH", policy: OBRangePolicy): { top: number; bottom: number } {
  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBot = Math.min(candle.open, candle.close);
  switch (policy) {
    case "FULL_CANDLE": return { top: candle.high, bottom: candle.low };
    case "BODY":        return { top: bodyTop, bottom: bodyBot };
    case "OPEN_TO_LOW":
      return kind === "BULLISH" ? { top: candle.open, bottom: candle.low } : { top: candle.high, bottom: candle.open };
    case "OPEN_TO_HIGH":
      return kind === "BULLISH" ? { top: candle.high, bottom: candle.open } : { top: candle.open, bottom: candle.low };
  }
}

function isBullish(c: CandleV2): boolean { return c.close > c.open; }
function isBearish(c: CandleV2): boolean { return c.close < c.open; }

function computeQuality(ob: Pick<OrderBlock, "displacementConfirmed" | "bosConfirmed" | "fvgAssociated" | "volumeConfirmation">): number {
  let q = 40;
  if (ob.displacementConfirmed) q += 20;
  if (ob.bosConfirmed) q += 20;
  if (ob.fvgAssociated) q += 15;
  if (ob.volumeConfirmation) q += 5;
  return Math.min(100, q);
}

function applyLifecycle(ob: OrderBlock, candles: ReadonlyArray<CandleV2>): void {
  const range = ob.top - ob.bottom;
  if (range <= 0) return;
  let invalidatedAt = -1;

  for (let k = ob.originIndex + 2; k < candles.length; k++) {
    const c = candles[k];
    const wickIn = c.low <= ob.top && c.high >= ob.bottom;
    if (wickIn && ob.state !== "INVALIDATED" && ob.state !== "BREAKER") {
      ob.touchCount++;
      const penetration = ob.type === "BULLISH"
        ? Math.min(ob.top, c.high) - Math.max(ob.bottom, c.low) === 0
          ? 0
          : (ob.top - Math.max(c.low, ob.bottom))
        : (Math.min(c.high, ob.top) - ob.bottom);
      const pct = Math.max(0, Math.min(100, (penetration / range) * 100));
      if (pct > ob.mitigationPercent) ob.mitigationPercent = pct;
      ob.state = ob.mitigationPercent >= 50 ? "MITIGATED" : "TOUCHED";
    }

    // Invalidation: close beyond the OB on the opposite side.
    if (ob.state !== "INVALIDATED" && ob.state !== "BREAKER") {
      if (ob.type === "BULLISH" && c.close < ob.bottom) {
        ob.state = "INVALIDATED";
        invalidatedAt = k;
      } else if (ob.type === "BEARISH" && c.close > ob.top) {
        ob.state = "INVALIDATED";
        invalidatedAt = k;
      }
    } else if (ob.state === "INVALIDATED" && invalidatedAt >= 0 && k > invalidatedAt) {
      // Breaker: price returns to the broken range after invalidation.
      if (c.low <= ob.top && c.high >= ob.bottom) {
        ob.state = "BREAKER";
      }
    }
  }
}

export interface DetectOrderBlocksOptions {
  rangePolicy?: OBRangePolicy;
  lookback?: number;
}

export function detectOrderBlocks(
  candles: ReadonlyArray<CandleV2>,
  fvgs: ReadonlyArray<FVG>,
  structure: ReadonlyArray<StructureEvent>,
  opts: DetectOrderBlocksOptions = {},
): OrderBlock[] {
  const out: OrderBlock[] = [];
  if (candles.length < 20) return out;

  const policy = opts.rangePolicy ?? DEFAULT_RANGE_POLICY;
  const lookback = opts.lookback ?? 200;
  const start = Math.max(15, candles.length - lookback);
  const atrSeries = atr14(candles);
  const seen = new Set<number>();

  for (let i = start; i < candles.length - 1; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const a = atrSeries[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    const displacement = body >= DISPLACEMENT_ATR_MULT * a;
    if (!displacement) continue;

    const dir: "BULLISH" | "BEARISH" = isBullish(c) ? "BULLISH" : isBearish(c) ? "BEARISH" : (c.close >= c.open ? "BULLISH" : "BEARISH");

    // BOS aligned within window.
    const bos = structure.find((s) =>
      s.type === "BOS" &&
      s.index >= i &&
      s.index <= i + BOS_WINDOW &&
      ((dir === "BULLISH" && s.direction === "long") || (dir === "BEARISH" && s.direction === "short")),
    );

    // FVG produced by the displacement (3-candle window centred at i).
    const fvg = fvgs.find((f) =>
      f.startIndex === i &&
      ((dir === "BULLISH" && f.type === "bullish") || (dir === "BEARISH" && f.type === "bearish")),
    );

    // Find the LAST opposite-color candle within OB_LOOKBACK bars before displacement.
    let originIdx = -1;
    for (let k = i - 1; k >= Math.max(0, i - OB_LOOKBACK); k--) {
      const cand = candles[k];
      const opposite = dir === "BULLISH" ? isBearish(cand) : isBullish(cand);
      if (opposite) { originIdx = k; break; }
    }
    if (originIdx < 0 || seen.has(originIdx)) continue;
    seen.add(originIdx);

    const origin = candles[originIdx];
    const { top, bottom } = rangeOf(origin, dir, policy);

    // Volume confirmation: only meaningful if the provider supplied volume.
    let volumeConfirmation = false;
    if (origin.volume !== undefined) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, originIdx - VOLUME_LOOKBACK); k < originIdx; k++) {
        const v = candles[k].volume;
        if (v !== undefined) { sum += v; count++; }
      }
      const avg = count > 0 ? sum / count : 0;
      volumeConfirmation = avg > 0 && origin.volume >= VOLUME_MULT * avg;
    }

    const ob: OrderBlock = {
      id: `ob-${originIdx}-${dir.toLowerCase()}`,
      type: dir,
      top,
      bottom,
      originIndex: originIdx,
      originTime: origin.time,
      state: "FRESH" as OBState,
      touchCount: 0,
      mitigationPercent: 0,
      displacementConfirmed: true,
      bosConfirmed: !!bos,
      fvgAssociated: !!fvg,
      volumeConfirmation,
      bosRef: bos?.id ?? null,
      fvgRef: fvg?.id ?? null,
      quality: 0,
      rangePolicy: policy,
    };

    // Canonical OB requires displacement + BOS + FVG (volume optional).
    if (!ob.bosConfirmed || !ob.fvgAssociated) continue;

    ob.quality = computeQuality(ob);
    applyLifecycle(ob, candles);
    out.push(ob);
  }

  return out;
}