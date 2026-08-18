import { createFileRoute } from "@tanstack/react-router";

/**
 * TEMPORARY diagnostic endpoint — probes the Alpaca Forex Market Data API.
 * Does not touch FMP / Alpha Vantage / Polygon / Twelve Data or the chart pipeline.
 * Credentials stay server-side; only status/schema info is returned.
 */

const BASE = "https://data.alpaca.markets/v1beta1/forex";

type Probe = {
  test: string;
  url: string;
  status: number;
  ok: boolean;
  rateLimit: Record<string, string>;
  schema?: unknown;
  body?: unknown;
  error?: string;
  resolvedSymbols?: string[];
  latest?: unknown;
  timestamp?: string | null;
  dataAgeSeconds?: number | null;
};

function shape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return depth > 3 ? "array" : [value.length > 0 ? shape(value[0], depth + 1) : "empty"];
  }
  if (typeof value === "object") {
    if (depth > 3) return "object";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = shape(v, depth + 1);
    return out;
  }
  return typeof value;
}

function ageSeconds(ts: string | null): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 1000);
}

function pickTimestamp(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  for (const key of ["t", "timestamp", "Timestamp"]) {
    const v = rec[key];
    if (typeof v === "string") return v;
  }
  return null;
}

async function probe(test: string, url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, { headers });
    const rateLimit: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase().includes("ratelimit") || k.toLowerCase().includes("retry-after"))
        rateLimit[k] = v;
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw text */
    }

    const result: Probe = {
      test,
      url,
      status: res.status,
      ok: res.ok,
      rateLimit,
      schema: shape(parsed),
      body: parsed,
    };

    if (res.ok && parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const container = (rec["rates"] ?? rec["currency_pairs"] ?? null) as Record<
        string,
        unknown
      > | null;
      if (container && typeof container === "object") {
        result.resolvedSymbols = Object.keys(container);
        const first = Object.values(container)[0];
        result.latest = first;
        const ts = pickTimestamp(Array.isArray(first) ? first[0] : first);
        result.timestamp = ts;
        result.dataAgeSeconds = ageSeconds(ts);
      }
    }
    return result;
  } catch (err) {
    return { test, url, status: 0, ok: false, rateLimit: {}, error: (err as Error).message };
  }
}

export const Route = createFileRoute("/api/public/diag/alpaca")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env["ALPACA_API_KEY"];
        const secret = process.env["ALPACA_SECRET_KEY"];
        if (!key || !secret) {
          return Response.json(
            { error: "ALPACA_API_KEY / ALPACA_SECRET_KEY not configured" },
            { status: 500 },
          );
        }
        const headers = {
          "APCA-API-KEY-ID": key,
          "APCA-API-SECRET-KEY": secret,
          accept: "application/json",
        };

        const results: Probe[] = [];
        results.push(
          await probe("test1_latest_XAUUSD", `${BASE}/latest/rates?currency_pairs=XAUUSD`, headers),
        );
        results.push(
          await probe(
            "test2_latest_XAU%2FUSD",
            `${BASE}/latest/rates?currency_pairs=${encodeURIComponent("XAU/USD")}`,
            headers,
          ),
        );
        results.push(
          await probe(
            "test3a_latest_EURUSD",
            `${BASE}/latest/rates?currency_pairs=EURUSD`,
            headers,
          ),
        );
        results.push(
          await probe(
            "test3b_latest_EUR%2FUSD",
            `${BASE}/latest/rates?currency_pairs=${encodeURIComponent("EUR/USD")}`,
            headers,
          ),
        );
        results.push(
          await probe(
            "test4_hist_XAUUSD_1Min",
            `${BASE}/rates?currency_pairs=XAUUSD&timeframe=1Min&limit=100&sort=desc`,
            headers,
          ),
        );
        results.push(
          await probe(
            "test4b_hist_XAU%2FUSD_1Min",
            `${BASE}/rates?currency_pairs=${encodeURIComponent("XAU/USD")}&timeframe=1Min&limit=100&sort=desc`,
            headers,
          ),
        );

        results.push(
          await probe(
            "control_stocks_iex_AAPL",
            "https://data.alpaca.markets/v2/stocks/AAPL/bars/latest?feed=iex",
            headers,
          ),
        );

        return Response.json(
          { ranAt: new Date().toISOString(), results },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
