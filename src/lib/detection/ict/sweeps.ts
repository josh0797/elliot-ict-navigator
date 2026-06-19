import type { CandleV2, PivotV2 } from "../schemas/analysis";
import type { LiquiditySweep } from "./types";

export function detectSweeps(candles: ReadonlyArray<CandleV2>, pivots: ReadonlyArray<PivotV2>): LiquiditySweep[] {
  const out: LiquiditySweep[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    for (const p of pivots) {
      if (p.index >= i) continue;
      if (p.type === "HIGH" && c.high > p.price && c.close < p.price) {
        out.push({ type: "buy_side", price: p.price, time: c.time, index: i });
      } else if (p.type === "LOW" && c.low < p.price && c.close > p.price) {
        out.push({ type: "sell_side", price: p.price, time: c.time, index: i });
      }
    }
  }
  return out;
}
