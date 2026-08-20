import type { Candle } from "@/lib/marketData/types";

export const ENTRY_TIME = Math.floor(Date.parse("2025-01-15T07:06:00Z") / 1000);
const MIN = 60;

/** Deterministic pseudo-random walk of M1 bars, `count` minutes ending at `endOpen`. */
export function m1Series(
  opts: {
    endOpen?: number;
    count?: number;
    seed?: number;
    startPrice?: number;
  } = {},
): Candle[] {
  const endOpen = opts.endOpen ?? ENTRY_TIME - MIN;
  const count = opts.count ?? 1500;
  let seed = opts.seed ?? 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let price = opts.startPrice ?? 2600;
  const out: Candle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const time = endOpen - i * MIN;
    const open = price;
    const drift = (rnd() - 0.5) * 0.8;
    const close = open + drift;
    const high = Math.max(open, close) + rnd() * 0.4;
    const low = Math.min(open, close) - rnd() * 0.4;
    out.push({ time, open, high, low, close, volume: 10 });
    price = close;
  }
  return out;
}

/** Forward M1 bars from the entry minute, moving `perMin` per minute. */
export function forwardSeries(
  entryTime: number,
  startPrice: number,
  perMin: number,
  minutes = 40,
  wick = 0.1,
): Candle[] {
  const entryMinute = Math.floor(entryTime / MIN) * MIN;
  const out: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < minutes; i++) {
    const open = price;
    const close = open + perMin;
    out.push({
      time: entryMinute + i * MIN,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: 10,
    });
    price = close;
  }
  return out;
}
