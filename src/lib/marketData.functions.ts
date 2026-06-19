import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCandles, type Candle } from "./twelvedata.functions";

/**
 * Market data adapter — Polygon (MASSIVE_API_KEY) primary, Twelve Data fallback.
 *
 * Interval contract (canonical): "1m" | "5m" | "15m" | "1h" | "4h" | "1d".
 * Also accepts Twelve Data style ("1min" | "5min" | "15min" | "1h" | "4h" | "1day") for compatibility.
 * Symbol contract: flat tickers with a single "/" — e.g. "EUR/USD", "BTC/USD", "USD/JPY".
 *   Crypto is detected when the quote leg is USD/USDT/USDC and the base is a known crypto symbol.
 */

const CRYPTO_BASES = new Set(["BTC", "ETH", "LTC", "TON", "SOL", "XRP", "ADA", "DOGE", "BNB", "AVAX", "MATIC", "DOT"]);

function classify(symbol: string): { kind: "crypto" | "forex"; base: string; quote: string } {
  const [base, quote] = symbol.toUpperCase().split("/");
  const isCrypto = CRYPTO_BASES.has(base);
  return { kind: isCrypto ? "crypto" : "forex", base, quote };
}

function toPolygonSymbol(symbol: string): string {
  const { kind, base, quote } = classify(symbol);
  return kind === "crypto" ? `X:${base}${quote}` : `C:${base}${quote}`;
}

function toPolygonInterval(interval: string): { multiplier: number; timespan: string } | null {
  switch (interval) {
    case "1m":
    case "1min": return { multiplier: 1, timespan: "minute" };
    case "5m":
    case "5min": return { multiplier: 5, timespan: "minute" };
    case "15m":
    case "15min": return { multiplier: 15, timespan: "minute" };
    case "30m":
    case "30min": return { multiplier: 30, timespan: "minute" };
    case "1h": return { multiplier: 1, timespan: "hour" };
    case "4h": return { multiplier: 4, timespan: "hour" };
    case "1d":
    case "1day": return { multiplier: 1, timespan: "day" };
    default: return null;
  }
}

function toTwelveDataInterval(interval: string): string {
  switch (interval) {
    case "1m": return "1min";
    case "5m": return "5min";
    case "15m": return "15min";
    case "30m": return "30min";
    case "1d": return "1day";
    default: return interval; // already 1h, 4h, 1day
  }
}

function intervalSeconds(interval: string): number {
  const p = toPolygonInterval(interval);
  if (!p) return 60 * 60;
  const unit = p.timespan === "minute" ? 60 : p.timespan === "hour" ? 3600 : 86400;
  return p.multiplier * unit;
}

async function fetchPolygon(symbol: string, interval: string, limit: number): Promise<{ candles: Candle[]; error?: string }> {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) return { candles: [], error: "MASSIVE_API_KEY missing" };
  const ivl = toPolygonInterval(interval);
  if (!ivl) return { candles: [], error: `unsupported interval ${interval}` };

  const ticker = toPolygonSymbol(symbol);
  const now = Date.now();
  const span = intervalSeconds(interval) * 1000 * limit * 1.5; // 50% slack for non-trading periods
  const from = now - span;
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${ivl.multiplier}/${ivl.timespan}/${from}/${now}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;
  try {
    const res = await fetch(url);
    const json = (await res.json()) as {
      status?: string;
      error?: string;
      results?: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }>;
    };
    if (!res.ok || json.status === "ERROR" || !json.results) {
      return { candles: [], error: json.error ?? `polygon ${res.status}` };
    }
    const candles: Candle[] = json.results.slice(-limit).map((r) => ({
      time: Math.floor(r.t / 1000),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));
    return { candles };
  } catch (err) {
    return { candles: [], error: (err as Error).message };
  }
}

const Input = z.object({
  symbol: z.string().min(3),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(2000).default(500),
});

export interface OhlcvResponse {
  candles: Candle[];
  provider: "polygon" | "twelvedata" | "none";
  error?: string;
}

/**
 * Try Polygon first (MASSIVE_API_KEY). On any failure or empty result, fall back to Twelve Data.
 */
export const fetchOhlcv = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<OhlcvResponse> => {
    const primary = await fetchPolygon(data.symbol, data.interval, data.outputsize);
    if (primary.candles.length > 0) return { candles: primary.candles, provider: "polygon" };

    const fallback = await fetchCandles({
      data: {
        symbol: data.symbol,
        interval: toTwelveDataInterval(data.interval),
        outputsize: data.outputsize,
      },
    });
    if (fallback.candles.length > 0) {
      return { candles: fallback.candles, provider: "twelvedata" };
    }
    return {
      candles: [],
      provider: "none",
      error: primary.error ?? fallback.error ?? "no data from any provider",
    };
  });

export { toPolygonSymbol, toPolygonInterval, toTwelveDataInterval };