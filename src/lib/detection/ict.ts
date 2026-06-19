import type { Candle, FVG, ICTContext, LiquiditySweep, OrderBlock, Pivot, StructureEvent } from "./types";

export function detectFVG(candles: Candle[]): FVG[] {
  const out: FVG[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    // bullish FVG: low of 3rd > high of 1st
    if (c.low > a.high) {
      out.push({ type: "bullish", top: c.low, bottom: a.high, time: candles[i - 1].time });
    } else if (c.high < a.low) {
      out.push({ type: "bearish", top: a.low, bottom: c.high, time: candles[i - 1].time });
    }
  }
  return out.slice(-30);
}

/** Order Block: last opposite-coloured candle before an impulsive move. */
export function detectOrderBlocks(candles: Candle[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const lookahead = 3;
  for (let i = 1; i < candles.length - lookahead; i++) {
    const c = candles[i];
    const isBear = c.close < c.open;
    const isBull = c.close > c.open;
    const future = candles.slice(i + 1, i + 1 + lookahead);
    const move = future[future.length - 1].close - c.close;
    const range = Math.abs(c.high - c.low);
    if (range === 0) continue;
    const impulse = Math.abs(move) / range;
    if (impulse < 1.5) continue;
    if (isBear && move > 0) {
      blocks.push({ type: "bullish", top: c.high, bottom: c.low, startTime: c.time, endTime: future[future.length - 1].time });
    } else if (isBull && move < 0) {
      blocks.push({ type: "bearish", top: c.high, bottom: c.low, startTime: c.time, endTime: future[future.length - 1].time });
    }
  }
  return blocks.slice(-15);
}

export function detectSweeps(candles: Candle[], pivots: Pivot[]): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  const recentHighs = pivots.filter((p) => p.type === "H").slice(-5);
  const recentLows = pivots.filter((p) => p.type === "L").slice(-5);
  for (let i = candles.length - 20; i < candles.length; i++) {
    if (i < 0) continue;
    const c = candles[i];
    for (const h of recentHighs) {
      if (h.index < i && c.high > h.price && c.close < h.price) {
        sweeps.push({ type: "buy_side", price: h.price, time: c.time });
      }
    }
    for (const l of recentLows) {
      if (l.index < i && c.low < l.price && c.close > l.price) {
        sweeps.push({ type: "sell_side", price: l.price, time: c.time });
      }
    }
  }
  return sweeps.slice(-10);
}

export function detectStructure(pivots: Pivot[]): StructureEvent[] {
  const events: StructureEvent[] = [];
  if (pivots.length < 4) return events;
  for (let i = 3; i < pivots.length; i++) {
    const p = pivots[i];
    const prevSame = pivots
      .slice(0, i)
      .reverse()
      .find((q) => q.type === p.type);
    if (!prevSame) continue;
    if (p.type === "H" && p.price > prevSame.price) {
      events.push({ type: "BOS", direction: "long", price: p.price, time: p.time });
    } else if (p.type === "L" && p.price < prevSame.price) {
      events.push({ type: "BOS", direction: "short", price: p.price, time: p.time });
    } else {
      // Lower high after series of HH → CHoCH bearish, etc.
      const dir: "long" | "short" = p.type === "H" ? "short" : "long";
      events.push({ type: "CHoCH", direction: dir, price: p.price, time: p.time });
    }
  }
  return events.slice(-10);
}

export function buildICT(candles: Candle[], pivots: Pivot[]): ICTContext {
  return {
    orderBlocks: detectOrderBlocks(candles),
    fvgs: detectFVG(candles),
    sweeps: detectSweeps(candles, pivots),
    structure: detectStructure(pivots),
  };
}