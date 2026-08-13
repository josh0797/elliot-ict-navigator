/**
 * Momentum indicators used by the wave-termination confirmation layer
 * (RSI, MACD histogram and simple momentum slope). Pure functions.
 */
import type { CandleV2 } from "../schemas/analysis";

export function rsi(candles: ReadonlyArray<CandleV2>, period = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(NaN);
  if (n <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const d = candles[i].close - candles[i - 1].close;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function ema(values: ReadonlyArray<number>, period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length === 0) return out;
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface MacdSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(
  candles: ReadonlyArray<CandleV2>,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  const closes = candles.map((c) => c.close);
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const signal = ema(line, signalPeriod);
  return { macd: line, signal, histogram: line.map((v, i) => v - signal[i]) };
}

/**
 * Bearish divergence: price makes a higher high while the oscillator makes a
 * lower high (mirrored for bullish). `window` limits how far back the previous
 * extreme is searched.
 */
export function hasDivergence(
  candles: ReadonlyArray<CandleV2>,
  series: ReadonlyArray<number>,
  direction: "long" | "short",
  window = 60,
): boolean {
  const n = candles.length;
  if (n < 20) return false;
  const from = Math.max(0, n - window);
  const recentFrom = Math.max(from + 5, n - Math.floor(window / 3));

  let curIdx = -1;
  let prevIdx = -1;
  const better = (a: number, b: number) => (direction === "long" ? a > b : a < b);
  const price = (i: number) => (direction === "long" ? candles[i].high : candles[i].low);

  for (let i = recentFrom; i < n; i++) {
    if (curIdx === -1 || better(price(i), price(curIdx))) curIdx = i;
  }
  for (let i = from; i < recentFrom; i++) {
    if (prevIdx === -1 || better(price(i), price(prevIdx))) prevIdx = i;
  }
  if (curIdx < 0 || prevIdx < 0) return false;
  const sc = series[curIdx];
  const sp = series[prevIdx];
  if (!Number.isFinite(sc) || !Number.isFinite(sp)) return false;
  // Price extended further but the oscillator did not.
  return better(price(curIdx), price(prevIdx)) && !better(sc, sp);
}
