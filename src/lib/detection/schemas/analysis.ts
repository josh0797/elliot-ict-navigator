/**
 * Canonical analysis types — Phase 1 contract.
 * These types are additive: legacy code in src/lib/detection/types.ts keeps working.
 */

export interface CandleV2 {
  index: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type PivotKind = "HIGH" | "LOW";
export type PivotStrength = "MINOR" | "MAJOR";

export interface PivotV2 {
  id: string;
  index: number;
  time: number;
  price: number;
  type: PivotKind;
  strength: PivotStrength;
  /** |Δprice from previous pivot| / ATR at pivot index. */
  atrDistance: number;
  /** true once enough bars on the right have printed without invalidation. */
  confirmed: boolean;
}

export interface Swing {
  from: PivotV2;
  to: PivotV2;
  direction: "up" | "down";
  magnitudeAtr: number;
  bars: number;
}

export interface CandleValidation {
  valid: boolean;
  warnings: string[];
}

export function validateCandles(candles: ReadonlyArray<{ time: number; open: number; high: number; low: number; close: number }>): CandleValidation {
  const warnings: string[] = [];
  if (candles.length === 0) {
    return { valid: false, warnings: ["empty candle array"] };
  }
  let prevTime = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) {
      warnings.push(`candle[${i}] has non-finite or non-positive price`);
      continue;
    }
    if (c.high < Math.max(c.open, c.close, c.low)) {
      warnings.push(`candle[${i}] high < max(open,close,low)`);
    }
    if (c.low > Math.min(c.open, c.close, c.high)) {
      warnings.push(`candle[${i}] low > min(open,close,high)`);
    }
    if (c.time <= prevTime) {
      warnings.push(`candle[${i}] time not strictly ascending`);
    }
    prevTime = c.time;
  }
  return { valid: warnings.length === 0, warnings };
}

/** Lift a legacy candle (time/open/high/low/close[/volume]) to CandleV2 with explicit index. */
export function liftCandles<T extends { time: number; open: number; high: number; low: number; close: number; volume?: number }>(
  candles: ReadonlyArray<T>,
): CandleV2[] {
  return candles.map((c, i) => ({
    index: i,
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}