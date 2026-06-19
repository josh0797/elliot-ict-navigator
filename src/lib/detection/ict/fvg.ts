import type { CandleV2 } from "../schemas/analysis";
import type { FVG } from "./types";

/**
 * 3-candle imbalance:
 *  Bullish FVG: low[i+1] > high[i-1]  → gap [high[i-1], low[i+1]]
 *  Bearish FVG: high[i+1] < low[i-1]  → gap [high[i+1], low[i-1]]
 */
export function detectFVGs(candles: ReadonlyArray<CandleV2>): FVG[] {
  const out: FVG[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const a = candles[i - 1];
    const c = candles[i + 1];
    if (c.low > a.high) {
      out.push({ id: `fvg-${i}-b`, type: "bullish", top: c.low, bottom: a.high, startIndex: i, startTime: candles[i].time, endTime: c.time, mitigated: false });
    } else if (c.high < a.low) {
      out.push({ id: `fvg-${i}-s`, type: "bearish", top: a.low, bottom: c.high, startIndex: i, startTime: candles[i].time, endTime: c.time, mitigated: false });
    }
  }
  for (const f of out) {
    for (let k = f.startIndex + 2; k < candles.length; k++) {
      const mid = (f.top + f.bottom) / 2;
      if (candles[k].low <= mid && candles[k].high >= mid) {
        f.mitigated = true;
        break;
      }
    }
  }
  return out;
}
