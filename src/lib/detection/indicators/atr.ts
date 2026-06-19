/**
 * True Range and Wilder ATR.
 * TR[t] = max(high-low, |high-close[t-1]|, |low-close[t-1]|)
 * ATR[t] uses Wilder's RMA: ATR[t] = (ATR[t-1] * (n-1) + TR[t]) / n
 */

import type { CandleV2 } from "../schemas/analysis";

export function trueRange(candles: ReadonlyArray<CandleV2>): number[] {
  const out: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      out[i] = c.high - c.low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  }
  return out;
}

export function atr(candles: ReadonlyArray<CandleV2>, period = 14): number[] {
  const tr = trueRange(candles);
  const n = tr.length;
  const out: number[] = new Array(n).fill(NaN);
  if (n < period) return out;

  // Seed with simple average of the first `period` TRs.
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;

  // Wilder RMA.
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export const atr14 = (candles: ReadonlyArray<CandleV2>) => atr(candles, 14);