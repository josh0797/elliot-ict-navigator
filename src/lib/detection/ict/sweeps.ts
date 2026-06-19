import type { CandleV2 } from "../schemas/analysis";
import type { LiquidityLevel, LiquiditySweep, StructureEvent } from "./types";

/**
 * Phase 6 canonical Liquidity Sweep detection.
 *
 * A sweep (raid / stop hunt) is registered when, for an ACTIVE liquidity level:
 *   - candle.high  > level.price  (BSL raid), or
 *   - candle.low   < level.price  (SSL raid).
 *
 * Stop-hunt confirmation: the candle closes back on the prior side of the level
 * (close < price for BSL, close > price for SSL). Without close-back, the sweep is
 * still recorded but with reduced quality (clean break, not a hunt).
 *
 * Displacement: a Break Of Structure in the opposite direction of the raid
 * within `DISPLACEMENT_WINDOW` bars after the sweep confirms intent.
 *
 * Mitigation: after the sweep, the swept range is mitigated once price trades
 * back into the wick (between candle close and level.price).
 */

const DISPLACEMENT_WINDOW = 10;

function qualityOf(s: { wickBeyond: boolean; closeBack: boolean; displacementAfter: boolean; level: LiquidityLevel }): number {
  let q = 30;
  if (s.wickBeyond) q += 20;
  if (s.closeBack) q += 25;
  if (s.displacementAfter) q += 15;
  q += Math.min(10, Math.round(s.level.strength / 10));
  return Math.min(100, q);
}

export function detectSweeps(
  candles: ReadonlyArray<CandleV2>,
  liquidity: ReadonlyArray<LiquidityLevel>,
  structure: ReadonlyArray<StructureEvent> = [],
): LiquiditySweep[] {
  const out: LiquiditySweep[] = [];
  const taken = new Set<string>();

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    for (const lvl of liquidity) {
      if (taken.has(lvl.id)) continue;
      if (lvl.originIndices.every((idx) => idx >= i)) continue;

      let hit = false;
      let side: "buy_side" | "sell_side" = "buy_side";
      let closeBack = false;
      if (lvl.side === "BSL" && c.high > lvl.price) {
        hit = true; side = "buy_side"; closeBack = c.close < lvl.price;
      } else if (lvl.side === "SSL" && c.low < lvl.price) {
        hit = true; side = "sell_side"; closeBack = c.close > lvl.price;
      }
      if (!hit) continue;
      taken.add(lvl.id);

      // Displacement: opposite-direction BOS within window.
      const oppositeDir = side === "buy_side" ? "short" : "long";
      const displacementAfter = structure.some(
        (s) => s.type === "BOS" && s.direction === oppositeDir && s.index >= i && s.index <= i + DISPLACEMENT_WINDOW,
      );

      // Mitigation: future candle re-enters the swept wick zone past the close.
      let mitigated = false;
      for (let k = i + 1; k < candles.length; k++) {
        const f = candles[k];
        if (side === "buy_side" && f.high >= lvl.price && f.low <= c.close) { mitigated = true; break; }
        if (side === "sell_side" && f.low <= lvl.price && f.high >= c.close) { mitigated = true; break; }
      }

      const sweep: LiquiditySweep = {
        id: `sweep-${i}-${lvl.id}`,
        side: lvl.side,
        type: side,
        price: lvl.price,
        time: c.time,
        index: i,
        targetLiquidityId: lvl.id,
        wickBeyond: true,
        closeBack,
        displacementAfter,
        mitigated,
        quality: 0,
      };
      sweep.quality = qualityOf({
        wickBeyond: sweep.wickBeyond,
        closeBack: sweep.closeBack,
        displacementAfter: sweep.displacementAfter,
        level: lvl,
      });
      out.push(sweep);
    }
  }
  return out;
}
