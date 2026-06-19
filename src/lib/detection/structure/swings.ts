import type { PivotV2, Swing } from "../schemas/analysis";
import { atr14 } from "../indicators/atr";
import type { CandleV2 } from "../schemas/analysis";

export function buildSwings(pivots: ReadonlyArray<PivotV2>, candles: ReadonlyArray<CandleV2>): Swing[] {
  if (pivots.length < 2) return [];
  const atrSeries = atr14(candles);
  const out: Swing[] = [];
  for (let i = 1; i < pivots.length; i++) {
    const from = pivots[i - 1];
    const to = pivots[i];
    const a = atrSeries[to.index] || 1e-9;
    out.push({
      from,
      to,
      direction: to.price > from.price ? "up" : "down",
      magnitudeAtr: Math.abs(to.price - from.price) / a,
      bars: to.index - from.index,
    });
  }
  return out;
}