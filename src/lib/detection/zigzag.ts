import type { Candle, Pivot } from "./types";

/**
 * Percent-based ZigZag pivot detector. `depth` defines minimum % move
 * required to confirm a new pivot, expressed as fraction (0.003 = 0.3%).
 */
export function zigzag(candles: Candle[], depth = 0.003): Pivot[] {
  if (candles.length < 5) return [];
  const pivots: Pivot[] = [];

  let lastType: "H" | "L" = candles[0].close >= candles[1].close ? "H" : "L";
  let lastIdx = 0;
  let lastPrice = lastType === "H" ? candles[0].high : candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (lastType === "H") {
      // looking for new high or confirmed low
      if (c.high > lastPrice) {
        lastPrice = c.high;
        lastIdx = i;
      } else if ((lastPrice - c.low) / lastPrice >= depth) {
        pivots.push({ index: lastIdx, time: candles[lastIdx].time, price: lastPrice, type: "H" });
        lastType = "L";
        lastPrice = c.low;
        lastIdx = i;
      }
    } else {
      if (c.low < lastPrice) {
        lastPrice = c.low;
        lastIdx = i;
      } else if ((c.high - lastPrice) / lastPrice >= depth) {
        pivots.push({ index: lastIdx, time: candles[lastIdx].time, price: lastPrice, type: "L" });
        lastType = "H";
        lastPrice = c.high;
        lastIdx = i;
      }
    }
  }
  // push the last forming pivot
  pivots.push({ index: lastIdx, time: candles[lastIdx].time, price: lastPrice, type: lastType });
  return pivots;
}