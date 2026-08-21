/** Twelve Data REST client — SERVER ONLY (plain functions, never server fns). */
import type { Candle } from "./types";

const TIMEFRAME_MAP: Record<string, string> = {
  "5min": "5min",
  "15min": "15min",
  "30min": "30min",
  "1h": "1h",
  "4h": "4h",
  "1day": "1day",
};

/**
 * Safe rate-limit diagnostics: Twelve Data returns per-request credit headers.
 * Only the two numeric headers are logged — never the API key or the URL.
 */
function logTwelveDataCredits(res: Response, label: string): void {
  const used = res.headers.get("api-credits-used");
  const left = res.headers.get("api-credits-left");
  if (used === null && left === null) return;
  console.info(`[mkt twelvedata] ${label} credits_used=${used ?? "?"} credits_left=${left ?? "?"}`);
}

export async function fetchTwelveDataCandles(input: {
  symbol: string;
  interval: string;
  outputsize: number;
  /** Optional upper bound (`YYYY-MM-DD HH:MM:SS`, UTC) used for paging. */
  endDate?: string;
}): Promise<{ candles: Candle[]; error?: string }> {
  const apiKey = process.env["TWELVEDATA_API_KEY"];
  if (!apiKey) return { candles: [], error: "TWELVEDATA_API_KEY missing" };

  const interval = TIMEFRAME_MAP[input.interval] ?? input.interval;
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", input.symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(input.outputsize));
  url.searchParams.set("format", "JSON");
  if (input.endDate) url.searchParams.set("end_date", input.endDate);
  url.searchParams.set("apikey", apiKey);


  try {
    const res = await fetch(url.toString(), { method: "GET" });
    logTwelveDataCredits(res, `time_series ${input.symbol} ${interval}`);
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
    // Twelve Data returns newest first → reverse to oldest first for charts.
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
}

export async function fetchTwelveDataPrice(
  symbol: string,
): Promise<{ price: number | null; error?: string }> {
  const apiKey = process.env["TWELVEDATA_API_KEY"];
  if (!apiKey) return { price: null, error: "TWELVEDATA_API_KEY missing" };
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  try {
    const r = await fetch(url);
    logTwelveDataCredits(r, `price ${symbol}`);
    const j = (await r.json()) as { price?: string; message?: string };
    if (!j.price) return { price: null, error: j.message ?? "no price" };
    return { price: Number(j.price) };
  } catch (err) {
    return { price: null, error: (err as Error).message };
  }
}
