import type { CandleV2 } from "../schemas/analysis";
import type { PDArray } from "./types";

export function computePdArray(candles: ReadonlyArray<CandleV2>, lookback = 100): PDArray | null {
  if (candles.length === 0) return null;
  const slice = candles.slice(-lookback);
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const current = slice[slice.length - 1].close;
  const range = high - low;
  if (range <= 0) return null;
  const position = (current - low) / range;
  const zone = position > 0.62 ? "PREMIUM" : position < 0.38 ? "DISCOUNT" : "EQUILIBRIUM";
  return { high, low, midpoint: (high + low) / 2, currentPrice: current, zone, position };
}
