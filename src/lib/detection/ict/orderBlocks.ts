import type { CandleV2 } from "../schemas/analysis";
import type { OrderBlock } from "./types";

/**
 * Last opposite-color candle before a displacement (body > 1.5x rolling avg body).
 */
export function detectOrderBlocks(candles: ReadonlyArray<CandleV2>, lookback = 200): OrderBlock[] {
  const out: OrderBlock[] = [];
  if (candles.length < 10) return out;
  const start = Math.max(1, candles.length - lookback);
  let bodySum = 0;
  let bodyCount = 0;
  for (let i = Math.max(0, start - 20); i < start; i++) {
    bodySum += Math.abs(candles[i].close - candles[i].open);
    bodyCount++;
  }
  const seen = new Set<number>();
  for (let i = start; i < candles.length; i++) {
    const body = Math.abs(candles[i].close - candles[i].open);
    const avg = bodyCount > 0 ? bodySum / bodyCount : body;
    if (avg > 0 && body > 1.5 * avg) {
      const dir = candles[i].close > candles[i].open ? "bullish" : "bearish";
      for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
        const opp = dir === "bullish" ? candles[k].close < candles[k].open : candles[k].close > candles[k].open;
        if (opp && !seen.has(k)) {
          seen.add(k);
          out.push({
            type: dir,
            top: Math.max(candles[k].open, candles[k].close, candles[k].high),
            bottom: Math.min(candles[k].open, candles[k].close, candles[k].low),
            index: k,
            time: candles[k].time,
            mitigated: false,
          });
          break;
        }
      }
    }
    bodySum += body;
    bodyCount++;
  }
  for (const ob of out) {
    for (let k = ob.index + 1; k < candles.length; k++) {
      if (candles[k].low <= ob.top && candles[k].high >= ob.bottom) {
        ob.mitigated = true;
        break;
      }
    }
  }
  return out;
}
