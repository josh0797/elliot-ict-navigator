import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCandles, type Candle } from "./twelvedata.functions";

/**
 * Market data adapter — provider cascade:
 *   1. Financial Modeling Prep (FMP_API_KEY)      ← primary
 *   2. Alpha Vantage (ALPHA_VANTAGE_API_KEY)      ← secondary / cross-check
 *   3. Polygon (MASSIVE_API_KEY)                  ← tertiary
 *   4. Twelve Data                                ← last resort
 *
 * Interval contract (canonical): "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w".
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
    case "1w": return "1week";
    default: return interval; // already 1h, 4h, 1day
  }
}

type CanonInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

function canonInterval(interval: string): CanonInterval | null {
  switch (interval) {
    case "1m": case "1min": return "1m";
    case "5m": case "5min": return "5m";
    case "15m": case "15min": return "15m";
    case "30m": case "30min": return "30m";
    case "1h": case "60min": case "1hour": return "1h";
    case "4h": case "4hour": return "4h";
    case "1d": case "1day": case "daily": return "1d";
    case "1w": case "1week": case "weekly": return "1w";
    default: return null;
  }
}

const CANON_SECONDS: Record<CanonInterval, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
};

/** Aggregate ascending candles into fixed-size buckets (used for 4h from 1h, 1w from 1d). */
function aggregate(candles: Candle[], bucketSeconds: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSeconds);
    if (!cur || bucket !== curBucket) {
      if (cur) out.push(cur);
      cur = { time: bucket * bucketSeconds, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
      curBucket = bucket;
      continue;
    }
    cur.high = Math.max(cur.high, c.high);
    cur.low = Math.min(cur.low, c.low);
    cur.close = c.close;
    cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
  }
  if (cur) out.push(cur);
  return out;
}

function sanitize(candles: Candle[], limit: number): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (!Number.isFinite(c.time) || c.time <= 0) continue;
    byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-limit);
}

function parseUtc(date: string): number {
  // FMP: "2024-05-03 14:00:00" (UTC) or "2024-05-03". AV: same shapes.
  const iso = date.includes(" ") ? `${date.replace(" ", "T")}Z` : `${date}T00:00:00Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

function flatSymbol(symbol: string): string {
  return symbol.toUpperCase().replace("/", "");
}

// ─── Financial Modeling Prep (primary) ───────────────────────────────────────

const FMP_INTRADAY: Partial<Record<CanonInterval, string>> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1hour", "4h": "4hour",
};

async function fetchFmp(symbol: string, interval: string, limit: number): Promise<{ candles: Candle[]; error?: string }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { candles: [], error: "FMP_API_KEY missing" };
  const ivl = canonInterval(interval);
  if (!ivl) return { candles: [], error: `unsupported interval ${interval}` };
  const ticker = flatSymbol(symbol);

  try {
    if (ivl === "1d" || ivl === "1w") {
      const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?apikey=${apiKey}&timeseries=${Math.min(5000, ivl === "1w" ? limit * 7 + 40 : limit + 10)}`;
      const res = await fetch(url);
      const json = (await res.json()) as {
        historical?: Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number }>;
        "Error Message"?: string;
      };
      if (!res.ok || json["Error Message"] || !json.historical) {
        return { candles: [], error: json["Error Message"] ?? `fmp ${res.status}` };
      }
      const daily = sanitize(
        json.historical.map((r) => ({
          time: parseUtc(r.date), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
        })),
        ivl === "1w" ? limit * 7 + 40 : limit,
      );
      return { candles: ivl === "1w" ? aggregate(daily, CANON_SECONDS["1w"]).slice(-limit) : daily };
    }

    const fmpIvl = FMP_INTRADAY[ivl]!;
    const url = `https://financialmodelingprep.com/api/v3/historical-chart/${fmpIvl}/${ticker}?apikey=${apiKey}`;
    const res = await fetch(url);
    const json = (await res.json()) as
      | Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number }>
      | { "Error Message"?: string };
    if (!res.ok || !Array.isArray(json)) {
      const msg = !Array.isArray(json) ? json["Error Message"] : undefined;
      return { candles: [], error: msg ?? `fmp ${res.status}` };
    }
    const candles = sanitize(
      json.map((r) => ({ time: parseUtc(r.date), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })),
      limit,
    );
    return { candles };
  } catch (err) {
    return { candles: [], error: (err as Error).message };
  }
}

// ─── Alpha Vantage (secondary) ───────────────────────────────────────────────

const AV_INTRADAY: Partial<Record<CanonInterval, string>> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "60min", "4h": "60min",
};

async function fetchAlphaVantage(symbol: string, interval: string, limit: number): Promise<{ candles: Candle[]; error?: string }> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return { candles: [], error: "ALPHA_VANTAGE_API_KEY missing" };
  const ivl = canonInterval(interval);
  if (!ivl) return { candles: [], error: `unsupported interval ${interval}` };
  const { kind, base, quote } = classify(symbol);

  const params = new URLSearchParams({ apikey: apiKey, outputsize: "full" });
  if (ivl === "1d" || ivl === "1w") {
    if (kind === "crypto") {
      params.set("function", ivl === "1w" ? "DIGITAL_CURRENCY_WEEKLY" : "DIGITAL_CURRENCY_DAILY");
      params.set("symbol", base);
      params.set("market", quote);
    } else {
      params.set("function", ivl === "1w" ? "FX_WEEKLY" : "FX_DAILY");
      params.set("from_symbol", base);
      params.set("to_symbol", quote);
    }
  } else {
    const avIvl = AV_INTRADAY[ivl]!;
    params.set("interval", avIvl);
    if (kind === "crypto") {
      params.set("function", "CRYPTO_INTRADAY");
      params.set("symbol", base);
      params.set("market", quote);
    } else {
      params.set("function", "FX_INTRADAY");
      params.set("from_symbol", base);
      params.set("to_symbol", quote);
    }
  }

  try {
    const res = await fetch(`https://www.alphavantage.co/query?${params.toString()}`);
    const json = (await res.json()) as Record<string, unknown>;
    const errMsg = (json["Error Message"] ?? json["Note"] ?? json["Information"]) as string | undefined;
    const seriesKey = Object.keys(json).find((k) => /Time Series|Digital Currency/i.test(k));
    if (!res.ok || !seriesKey) return { candles: [], error: errMsg ?? `alphavantage ${res.status}` };
    const series = json[seriesKey] as Record<string, Record<string, string>>;
    const pick = (row: Record<string, string>, field: "open" | "high" | "low" | "close"): number => {
      const key = Object.keys(row).find((k) => k.toLowerCase().includes(field));
      return key ? Number(row[key]) : NaN;
    };
    const raw = Object.entries(series).map(([date, row]) => ({
      time: parseUtc(date),
      open: pick(row, "open"),
      high: pick(row, "high"),
      low: pick(row, "low"),
      close: pick(row, "close"),
    }));
    // 4h is not offered by AV — aggregate from 60min.
    if (ivl === "4h") {
      const hourly = sanitize(raw, limit * 4 + 20);
      return { candles: aggregate(hourly, CANON_SECONDS["4h"]).slice(-limit) };
    }
    return { candles: sanitize(raw, limit) };
  } catch (err) {
    return { candles: [], error: (err as Error).message };
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
  provider: MarketProvider;
  error?: string;
}

export type MarketProvider = "fmp" | "alphavantage" | "polygon" | "twelvedata" | "none";

/**
 * Provider cascade: FMP → Alpha Vantage → Polygon → Twelve Data.
 * The first provider returning usable candles wins; the rest are never called.
 */
export const fetchOhlcv = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<OhlcvResponse> => {
    const errors: string[] = [];

    const fmp = await fetchFmp(data.symbol, data.interval, data.outputsize);
    if (fmp.candles.length > 0) return { candles: fmp.candles, provider: "fmp" };
    if (fmp.error) errors.push(`fmp: ${fmp.error}`);

    const av = await fetchAlphaVantage(data.symbol, data.interval, data.outputsize);
    if (av.candles.length > 0) return { candles: av.candles, provider: "alphavantage" };
    if (av.error) errors.push(`alphavantage: ${av.error}`);

    const poly = await fetchPolygon(data.symbol, data.interval, data.outputsize);
    if (poly.candles.length > 0) return { candles: poly.candles, provider: "polygon" };
    if (poly.error) errors.push(`polygon: ${poly.error}`);

    const td = await fetchCandles({
      data: {
        symbol: data.symbol,
        interval: toTwelveDataInterval(canonInterval(data.interval) ?? data.interval),
        outputsize: data.outputsize,
      },
    });
    if (td.candles.length > 0) return { candles: td.candles, provider: "twelvedata" };
    if (td.error) errors.push(`twelvedata: ${td.error}`);

    return { candles: [], provider: "none", error: errors.join(" | ") || "no data from any provider" };
  });

export { toPolygonSymbol, toPolygonInterval, toTwelveDataInterval, canonInterval, aggregate };