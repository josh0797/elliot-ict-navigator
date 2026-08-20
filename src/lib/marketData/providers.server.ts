/**
 * Market data providers — SERVER ONLY.
 *
 * Every runtime helper of the market-data cascade lives here (never in
 * `*.functions.ts`): TanStack's server-fn split transform removes sibling
 * declarations from a module that declares `createServerFn`, which produced
 * runtime `ReferenceError`s in production.
 *
 * Provider cascade (see `resolveCascade`): true-OHLC providers first
 * (Twelve Data -> Polygon/Massive -> Alpha Vantage), with MetalPrice API only as
 * a last-resort metals daily/weekly fallback because its history is synthetic.
 * A provider only wins when its series is BOTH non-empty AND fresh; series from
 * different providers are never blended.
 */
import { evaluateFreshness, pickLeastStale, type Freshness } from "./freshness";
import { fetchTwelveDataCandles } from "./twelvedata.server";
import { AsyncCache, ohlcvKey, ttlForTimeframe } from "./async-cache";
import { GuardRegistry, parseRetryAfter } from "./limiter";
import { logDataEvent, newRequestId } from "./instrumentation";
import type { Candle, DataMeta, MarketProvider, OhlcvResponse } from "./types";

/** Result contract every provider fetcher returns. */
export interface ProviderResult {
  candles: Candle[];
  error?: string;
  /** HTTP status, when the provider answered at all (429 trips the breaker). */
  httpStatus?: number;
  retryAfterMs?: number;
  /** Provider rejected the request for quota/plan reasons (premium-only, credits). */
  quota?: boolean;
}

const CRYPTO_BASES = new Set([
  "BTC",
  "ETH",
  "LTC",
  "TON",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "BNB",
  "AVAX",
  "MATIC",
  "DOT",
]);

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
    case "1min":
      return { multiplier: 1, timespan: "minute" };
    case "5m":
    case "5min":
      return { multiplier: 5, timespan: "minute" };
    case "15m":
    case "15min":
      return { multiplier: 15, timespan: "minute" };
    case "30m":
    case "30min":
      return { multiplier: 30, timespan: "minute" };
    case "1h":
      return { multiplier: 1, timespan: "hour" };
    case "4h":
      return { multiplier: 4, timespan: "hour" };
    case "1d":
    case "1day":
      return { multiplier: 1, timespan: "day" };
    default:
      return null;
  }
}

function toTwelveDataInterval(interval: string): string {
  switch (interval) {
    case "1m":
      return "1min";
    case "5m":
      return "5min";
    case "15m":
      return "15min";
    case "30m":
      return "30min";
    case "1d":
      return "1day";
    case "1w":
      return "1week";
    default:
      return interval; // already 1h, 4h, 1day
  }
}

type CanonInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

function canonInterval(interval: string): CanonInterval | null {
  switch (interval) {
    case "1m":
    case "1min":
      return "1m";
    case "5m":
    case "5min":
      return "5m";
    case "15m":
    case "15min":
      return "15m";
    case "30m":
    case "30min":
      return "30m";
    case "1h":
    case "60min":
    case "1hour":
      return "1h";
    case "4h":
    case "4hour":
      return "4h";
    case "1d":
    case "1day":
    case "daily":
      return "1d";
    case "1w":
    case "1week":
    case "weekly":
      return "1w";
    default:
      return null;
  }
}

const CANON_SECONDS: Record<CanonInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
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
      cur = {
        time: bucket * bucketSeconds,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      };
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

// ─── MetalPrice API (primary) ────────────────────────────────────────────────

const METALPRICE_BASE = "https://api.metalpriceapi.com/v1";

function ymd(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Live rate for BASE/QUOTE from MetalPrice API (base=BASE, currencies=QUOTE). */
async function fetchMetalPriceLatest(
  symbol: string,
): Promise<{ price: number | null; error?: string }> {
  const apiKey = process.env["METALPRICE_API_KEY"];
  if (!apiKey) return { price: null, error: "METALPRICE_API_KEY missing" };
  const { base, quote } = classify(symbol);
  try {
    const res = await fetch(
      `${METALPRICE_BASE}/latest?api_key=${apiKey}&base=${base}&currencies=${quote}`,
    );
    const json = (await res.json()) as {
      success?: boolean;
      rates?: Record<string, number>;
      error?: { message?: string } | string;
    };
    const rate = json.rates?.[quote] ?? json.rates?.[`${base}${quote}`];
    if (!res.ok || json.success === false || !Number.isFinite(rate)) {
      const msg = typeof json.error === "string" ? json.error : json.error?.message;
      return { price: null, error: msg ?? `metalpriceapi ${res.status}` };
    }
    return { price: rate as number };
  } catch (err) {
    return { price: null, error: (err as Error).message };
  }
}

/**
 * Daily / weekly series from MetalPrice API `/v1/timeframe` (one rate per day).
 *
 * WARNING — SYNTHETIC OHLC, FALLBACK ONLY: the endpoint returns a single
 * point-in-time rate per date, NOT the true daily close, and the OHLC below is
 * reconstructed from that rate sequence (open = previous rate, high/low =
 * envelope). Observed 2026-08-19 divergence vs the real daily close was ~180
 * USD on XAU/USD. `resolveCascade` therefore places this provider LAST for
 * metals daily/weekly, behind true-OHLC providers.
 */

async function fetchMetalPrice(
  symbol: string,
  interval: string,
  limit: number,
): Promise<ProviderResult> {
  const apiKey = process.env["METALPRICE_API_KEY"];
  if (!apiKey) return { candles: [], error: "METALPRICE_API_KEY missing" };
  const ivl = canonInterval(interval);
  if (ivl !== "1d" && ivl !== "1w")
    return { candles: [], error: "metalpriceapi: intraday not supported" };
  const { base, quote } = classify(symbol);

  const days = Math.min(365, ivl === "1w" ? limit * 7 + 14 : limit + 10);
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  try {
    const url =
      `${METALPRICE_BASE}/timeframe?api_key=${apiKey}` +
      `&start_date=${ymd(start)}&end_date=${ymd(end)}&base=${base}&currencies=${quote}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      success?: boolean;
      rates?: Record<string, Record<string, number>>;
      error?: { message?: string } | string;
    };
    if (!res.ok || json.success === false || !json.rates) {
      const msg = typeof json.error === "string" ? json.error : json.error?.message;
      return {
        candles: [],
        error: msg ?? `metalpriceapi ${res.status}`,
        httpStatus: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        quota: res.status === 429 || res.status === 402 || res.status === 403,
      };
    }
    const closes = Object.entries(json.rates)
      .map(([date, row]) => ({ time: parseUtc(date), close: row[quote] ?? row[`${base}${quote}`] }))
      .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.close) && (r.close as number) > 0)
      .sort((a, b) => a.time - b.time);
    if (closes.length === 0) return { candles: [], error: "metalpriceapi: empty series" };

    const daily: Candle[] = closes.map((r, i) => {
      const open = i === 0 ? r.close : closes[i - 1].close;
      return {
        time: r.time,
        open,
        high: Math.max(open, r.close),
        low: Math.min(open, r.close),
        close: r.close,
      };
    });
    const out = ivl === "1w" ? aggregate(daily, CANON_SECONDS["1w"]) : daily;
    return { candles: sanitize(out, limit) };
  } catch (err) {
    return { candles: [], error: (err as Error).message };
  }
}

// NOTE: the OHLC of a closed candle is NEVER patched with a live spot quote.
// The live rate travels next to the series as `livePrice` so the historical
// series stays exactly as the serving provider published it.

// ─── Financial Modeling Prep ─────────────────────────────────────────────────

const FMP_INTRADAY: Partial<Record<CanonInterval, string>> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1hour",
  "4h": "4hour",
};

async function fetchFmp(symbol: string, interval: string, limit: number): Promise<ProviderResult> {
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
        historical?: Array<{
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume?: number;
        }>;
        "Error Message"?: string;
      };
      if (!res.ok || json["Error Message"] || !json.historical) {
        return { candles: [], error: json["Error Message"] ?? `fmp ${res.status}` };
      }
      const daily = sanitize(
        json.historical.map((r) => ({
          time: parseUtc(r.date),
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volume,
        })),
        ivl === "1w" ? limit * 7 + 40 : limit,
      );
      return {
        candles: ivl === "1w" ? aggregate(daily, CANON_SECONDS["1w"]).slice(-limit) : daily,
      };
    }

    const fmpIvl = FMP_INTRADAY[ivl]!;
    const url = `https://financialmodelingprep.com/api/v3/historical-chart/${fmpIvl}/${ticker}?apikey=${apiKey}`;
    const res = await fetch(url);
    const json = (await res.json()) as
      | Array<{
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume?: number;
        }>
      | { "Error Message"?: string };
    if (!res.ok || !Array.isArray(json)) {
      const msg = !Array.isArray(json) ? json["Error Message"] : undefined;
      return { candles: [], error: msg ?? `fmp ${res.status}` };
    }
    const candles = sanitize(
      json.map((r) => ({
        time: parseUtc(r.date),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      })),
      limit,
    );
    return { candles };
  } catch (err) {
    return { candles: [], error: (err as Error).message };
  }
}

// ─── Alpha Vantage (secondary) ───────────────────────────────────────────────

const AV_INTRADAY: Partial<Record<CanonInterval, string>> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "60min",
  "4h": "60min",
};

async function fetchAlphaVantage(
  symbol: string,
  interval: string,
  limit: number,
): Promise<ProviderResult> {
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
    const errMsg = (json["Error Message"] ?? json["Note"] ?? json["Information"]) as
      | string
      | undefined;
    const seriesKey = Object.keys(json).find((k) => /Time Series|Digital Currency/i.test(k));
    if (!res.ok || !seriesKey) {
      const msg = errMsg ?? `alphavantage ${res.status}`;
      return {
        candles: [],
        error: msg,
        httpStatus: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        quota: res.status === 429 || /premium|higher API call|rate limit/i.test(msg),
      };
    }
    const series = json[seriesKey] as Record<string, Record<string, string>>;
    const pick = (
      row: Record<string, string>,
      field: "open" | "high" | "low" | "close",
    ): number => {
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

async function fetchPolygon(
  symbol: string,
  interval: string,
  limit: number,
): Promise<ProviderResult> {
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
      return {
        candles: [],
        error: json.error ?? `polygon ${res.status}`,
        httpStatus: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        quota: res.status === 429 || res.status === 403,
      };
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

/** Seconds per canonical bucket for freshness math. */
function bucketSeconds(interval: string): number {
  const ivl = canonInterval(interval);
  return ivl ? CANON_SECONDS[ivl] : 3600;
}

/**
 * Drop the still-forming candle: any bar whose bucket equals the bucket the
 * current time falls into is incomplete and must never reach the engines.
 */
function dropOpenCandle(candles: Candle[], interval: string, nowSeconds: number): Candle[] {
  if (candles.length === 0) return candles;
  const sec = bucketSeconds(interval);
  const currentBucket = Math.floor(nowSeconds / sec) * sec;
  const last = candles[candles.length - 1];
  return last.time >= currentBucket ? candles.slice(0, -1) : candles;
}

function buildMeta(
  candles: Candle[],
  provider: MarketProvider,
  interval: string,
  nowSeconds: number,
): DataMeta | undefined {
  if (candles.length === 0) return undefined;
  const sec = bucketSeconds(interval);
  const last = candles[candles.length - 1];
  const freshness = evaluateFreshness({
    lastCandleTime: last.time,
    intervalSeconds: sec,
    nowSeconds,
  });
  return {
    provider,
    interval,
    intervalSeconds: sec,
    lastCandleTime: last.time,
    lastCandleIso: new Date(last.time * 1000).toISOString(),
    lastClose: last.close,
    ageSeconds: freshness.ageSeconds,
    stale: freshness.stale,
    candles: candles.length,
    freshness,
  };
}

/** Normalise one provider result into the canonical closed-candle snapshot. */
function finalize(
  candles: Candle[],
  provider: MarketProvider,
  interval: string,
  nowSeconds: number,
  livePrice: number | null,
): OhlcvResponse {
  const closed = dropOpenCandle(sanitizeAscending(candles), interval, nowSeconds);
  const meta = buildMeta(closed, provider, interval, nowSeconds);
  return {
    candles: closed,
    provider,
    meta,
    status: meta?.stale ? "DATA_STALE" : "OK",
    livePrice,
    asOf: nowSeconds,
  };
}

function sanitizeAscending(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.time - b.time);
}

// ── Shared server-side state: cache + coalescing + per-provider guards ──────
const ohlcvCache = new AsyncCache();
const guards = new GuardRegistry();

/** Test/ops hook: drop cached snapshots and reopen every breaker. */
export function resetMarketDataCaches(): void {
  ohlcvCache.invalidate();
  guards.reset();
}

const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);

function isIntraday(interval: string): boolean {
  const ivl = canonInterval(interval) ?? interval;
  return ivl !== "1d" && ivl !== "1w" && ivl !== "1M";
}

/**
 * Provider order for a (symbol, interval) pair. Providers that structurally
 * cannot serve the request are never attempted — that alone removes most of
 * the wasted upstream calls.
 */
export function resolveCascade(
  symbol: string,
  interval: string,
  env: Record<string, string | undefined> = process.env,
): MarketProvider[] {
  const intraday = isIntraday(interval);
  const { base } = classify(symbol);
  const list: MarketProvider[] = [];

  // True-OHLC providers always come first. MetalPrice only publishes ONE rate
  // per day, so its daily/weekly "OHLC" is synthetic (see fetchMetalPrice) and
  // may differ materially from the real daily close → last-resort only.
  if (env["TWELVEDATA_API_KEY"]) list.push("twelvedata");
  // Polygon / Massive is the intraday workhorse.
  if (env["POLYGON_API_KEY"] || env["MASSIVE_API_KEY"]) list.push("polygon");
  // Alpha Vantage intraday FX requires a premium plan; free keys only do daily.
  if (env["ALPHA_VANTAGE_API_KEY"] && (!intraday || env["ALPHA_VANTAGE_PREMIUM"] === "true"))
    list.push("alphavantage");
  // FMP legacy endpoint is opt-in until migrated to the current API.
  if (env["FMP_API_KEY"] && env["FMP_LEGACY_ENABLED"] === "true") list.push("fmp");
  // Metals daily/weekly fallback of last resort (synthetic OHLC).
  if (!intraday && METALS.has(base) && env["METALPRICE_API_KEY"]) list.push("metalpriceapi");
  return list;
}

function runProvider(
  provider: MarketProvider,
  data: { symbol: string; interval: string; outputsize: number },
): Promise<ProviderResult> {
  switch (provider) {
    case "metalpriceapi":
      return fetchMetalPrice(data.symbol, data.interval, data.outputsize);
    case "fmp":
      return fetchFmp(data.symbol, data.interval, data.outputsize);
    case "alphavantage":
      return fetchAlphaVantage(data.symbol, data.interval, data.outputsize);
    case "polygon":
      return fetchPolygon(data.symbol, data.interval, data.outputsize);
    case "twelvedata":
      return fetchTwelveDataCandles({
        symbol: data.symbol,
        interval: toTwelveDataInterval(canonInterval(data.interval) ?? data.interval),
        outputsize: Math.min(2000, data.outputsize),
      });
    default:
      return Promise.resolve({ candles: [], error: "unknown provider" });
  }
}

/**
 * Cached + coalesced provider call. Identical concurrent requests for
 * `provider:symbol:timeframe:limit` share ONE upstream fetch, and a provider
 * that is rate-limited or tripped open is skipped without any network call.
 */
async function fetchGuarded(
  provider: MarketProvider,
  data: { symbol: string; interval: string; outputsize: number },
  requestId: string,
): Promise<ProviderResult & { skipped?: boolean }> {
  const guard = guards.get(provider);
  const key = ohlcvKey({
    provider,
    symbol: data.symbol,
    timeframe: data.interval,
    limit: data.outputsize,
  });

  // A fresh cached payload is served even while the breaker is open; only the
  // upstream call inside the cache miss path is gated.
  let ran = false;
  const started = Date.now();
  try {
    const { value, outcome } = await ohlcvCache.resolve(
      key,
      ttlForTimeframe(canonInterval(data.interval) ?? data.interval),
      async () => {
        const acq = guard.tryAcquire();
        if (!acq.ok) {
          const err = new Error(`${provider}: ${acq.reason} (retry in ${acq.retryAfterMs}ms)`);
          (err as Error & { skipped?: boolean }).skipped = true;
          throw err;
        }
        ran = true;
        return runProvider(provider, data);
      },
    );
    if (ran) {
      if (value.error && (value.httpStatus === 429 || value.quota)) {
        guard.onFailure(value.quota ? "quota" : "rate_limited", value.retryAfterMs);
      } else if (value.error && value.candles.length === 0) {
        guard.onFailure("error");
      } else {
        guard.onSuccess();
      }
    }
    logDataEvent({
      requestId,
      provider,
      symbol: data.symbol,
      timeframe: data.interval,
      limit: data.outputsize,
      cache: outcome,
      outcome: value.error ? "error" : value.candles.length ? "served" : "empty",
      reason: value.error,
      candles: value.candles.length,
      ms: Date.now() - started,
    });
    return value;
  } catch (err) {
    const skipped = (err as Error & { skipped?: boolean }).skipped === true;
    if (!skipped) guard.onFailure("error");
    logDataEvent({
      requestId,
      provider,
      symbol: data.symbol,
      timeframe: data.interval,
      limit: data.outputsize,
      outcome: "skipped",
      reason: (err as Error).message,
      ms: Date.now() - started,
    });
    return { candles: [], error: (err as Error).message, skipped };
  }
}

const livePriceCache = new AsyncCache();

async function livePriceFor(symbol: string): Promise<{ price: number | null; error?: string }> {
  const { base } = classify(symbol);
  if (!METALS.has(base) || !process.env["METALPRICE_API_KEY"]) return { price: null };
  const guard = guards.get("metalpriceapi");
  if (guard.isOpen()) return { price: null, error: "metalpriceapi cooling down" };
  const { value } = await livePriceCache.resolve(`live:${symbol}`, 60_000, () =>
    fetchMetalPriceLatest(symbol),
  );
  return value;
}

/**
 * Runs the (filtered) provider cascade and returns a canonical closed-candle
 * snapshot. Result is cached per provider:symbol:timeframe:limit, so Elliott,
 * ICT, setups, Fibonacci and liquidity all reuse the SAME dataset instead of
 * re-querying upstream.
 */
export async function loadOhlcv(data: {
  symbol: string;
  interval: string;
  outputsize: number;
}): Promise<OhlcvResponse> {
  const errors: string[] = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const requestId = newRequestId();

  const cascade = resolveCascade(data.symbol, data.interval);
  if (cascade.length === 0) {
    return {
      candles: [],
      provider: "none",
      status: "DATA_STALE",
      asOf: nowSeconds,
      livePrice: null,
      error: `no provider configured for ${data.symbol} ${data.interval}`,
    };
  }

  const live = await livePriceFor(data.symbol);
  if (live.error) errors.push(`metalpriceapi(latest): ${live.error}`);

  const staleAttempts: Array<OhlcvResponse & { freshness: Freshness }> = [];
  for (const provider of cascade) {
    const res = await fetchGuarded(provider, data, requestId);
    if (res.error) errors.push(`${provider}: ${res.error}`);
    if (res.candles.length === 0) continue;
    const snapshot = finalize(res.candles, provider, data.interval, nowSeconds, live.price);
    if (snapshot.candles.length === 0 || !snapshot.meta) continue;
    if (!snapshot.meta.stale) return snapshot;
    errors.push(`${provider}: stale (${snapshot.meta.freshness.reason ?? "lagging series"})`);
    staleAttempts.push({ ...snapshot, freshness: snapshot.meta.freshness });
  }

  const best = pickLeastStale(staleAttempts);
  if (best) {
    return {
      ...best,
      status: "DATA_STALE",
      error: `DATA_STALE — ${best.provider}: ${best.meta?.freshness.reason ?? "lagging series"}`,
    };
  }

  return {
    candles: [],
    provider: "none",
    status: "DATA_STALE",
    asOf: nowSeconds,
    livePrice: live.price,
    error: errors.join(" | ") || "no data from any provider",
  };
}
