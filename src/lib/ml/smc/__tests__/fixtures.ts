import type { Candle } from "@/lib/marketData/types";
import type { LiquiditySweep, StructureEvent } from "@/lib/detection/ict/types";
import type { SmcFeatureContext } from "../types";

export const BASE_TIME = Math.floor(Date.parse("2025-01-15T06:00:00Z") / 1000);
const M5 = 300;

/** Flat, low-volatility series — no expansion, no sweeps. */
export function flatCandles(count = 40, price = 2000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: BASE_TIME + i * M5,
    open: price,
    high: price + 0.5,
    low: price - 0.5,
    close: price,
    volume: 100,
  }));
}

/** Series ending with a downside wick raid that closes back up (long reversal). */
export function sweepReversalCandles(): Candle[] {
  const c = flatCandles(30);
  const last = c.length - 1;
  c[last - 1] = {
    time: c[last - 1].time,
    open: 2000,
    high: 2000.5,
    low: 1994,
    close: 2000.2,
    volume: 300,
  };
  c[last] = {
    time: c[last].time,
    open: 2000.2,
    high: 2006,
    low: 2000,
    close: 2005.5,
    volume: 400,
  };
  return c;
}

/** Series with three strong up-closes and range expansion (continuation). */
export function continuationCandles(): Candle[] {
  const c = flatCandles(30);
  for (let k = 3; k >= 1; k--) {
    const i = c.length - k;
    const base = 2000 + (4 - k) * 3;
    c[i] = {
      time: c[i].time,
      open: base,
      high: base + 3.2,
      low: base - 0.2,
      close: base + 3,
      volume: 500,
    };
  }
  return c;
}

export function sweep(
  over: Partial<LiquiditySweep> & { time: number; index: number },
): LiquiditySweep {
  return {
    id: "s1",
    side: "SSL",
    type: "sell_side",
    price: 1994,
    wickBeyond: true,
    closeBack: true,
    displacementAfter: false,
    mitigated: false,
    quality: 70,
    ...over,
  };
}

export function structureEvent(over: Partial<StructureEvent> & { time: number }): StructureEvent {
  return {
    id: "e1",
    type: "BOS",
    direction: "long",
    price: 2001,
    index: 28,
    state: "CONFIRMED",
    brokenPivotId: "p1",
    breakIndex: 28,
    breakPrice: 2001,
    closeBeyondAtr: 1.2,
    displacement: true,
    ...over,
  };
}

export function ctxFrom(candles: Candle[], over: Partial<SmcFeatureContext> = {}): SmcFeatureContext {
  return {
    candles,
    atTime: candles[candles.length - 1].time,
    direction: "long",
    atr: 2,
    ...over,
  };
}
