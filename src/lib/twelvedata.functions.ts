import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TimeframeMap: Record<string, string> = {
  "5min": "5min",
  "15min": "15min",
  "30min": "30min",
  "1h": "1h",
  "4h": "4h",
  "1day": "1day",
};

export type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

const Input = z.object({
  symbol: z.string().min(3),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(2000).default(500),
});

/**
 * Fetches OHLCV candles from Twelve Data. The API key stays on the server.
 */
export const fetchCandles = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{ candles: Candle[]; error?: string }> => {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) return { candles: [], error: "TWELVEDATA_API_KEY missing" };

    const interval = TimeframeMap[data.interval] ?? data.interval;
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", data.symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", String(data.outputsize));
    url.searchParams.set("format", "JSON");
    url.searchParams.set("apikey", apiKey);

    try {
      const res = await fetch(url.toString(), { method: "GET" });
      const json = (await res.json()) as {
        status?: string;
        message?: string;
        values?: Array<{
          datetime: string;
          open: string;
          high: string;
          low: string;
          close: string;
          volume?: string;
        }>;
      };
      if (json.status === "error" || !json.values) {
        return { candles: [], error: json.message ?? "Twelve Data error" };
      }
      // Twelve Data returns newest first → reverse to oldest first for charts
      const candles: Candle[] = json.values
        .slice()
        .reverse()
        .map((v) => ({
          time: Math.floor(new Date(v.datetime + "Z").getTime() / 1000),
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
          volume: v.volume ? Number(v.volume) : undefined,
        }));
      return { candles };
    } catch (err) {
      return { candles: [], error: (err as Error).message };
    }
  });

/** Current spot price for a symbol (used to evaluate live setups). */
export const fetchPrice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data }): Promise<{ price: number | null; error?: string }> => {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) return { price: null, error: "TWELVEDATA_API_KEY missing" };
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(data.symbol)}&apikey=${apiKey}`;
    try {
      const r = await fetch(url);
      const j = (await r.json()) as { price?: string; message?: string };
      if (!j.price) return { price: null, error: j.message ?? "no price" };
      return { price: Number(j.price) };
    } catch (err) {
      return { price: null, error: (err as Error).message };
    }
  });