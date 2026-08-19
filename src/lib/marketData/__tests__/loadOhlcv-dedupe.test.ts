import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadOhlcv, resolveCascade, resetMarketDataCaches } from "../providers.server";

const realFetch = globalThis.fetch;

function polygonPayload(bars: number) {
  const now = Math.floor(Date.now() / 1000);
  const step = 14_400;
  return {
    status: "OK",
    results: Array.from({ length: bars }, (_, i) => ({
      t: (now - (bars - i) * step) * 1000,
      o: 2000 + i,
      h: 2005 + i,
      l: 1995 + i,
      c: 2001 + i,
      v: 10,
    })),
  };
}

describe("loadOhlcv upstream discipline", () => {
  beforeEach(() => {
    resetMarketDataCaches();
    process.env["MASSIVE_API_KEY"] = "test-key";
    delete process.env["METALPRICE_API_KEY"];
    delete process.env["TWELVEDATA_API_KEY"];
    delete process.env["ALPHA_VANTAGE_API_KEY"];
    delete process.env["FMP_API_KEY"];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetMarketDataCaches();
  });

  it("collapses concurrent XAU/USD|4h|2000 consumers into a single upstream call", async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify(polygonPayload(400)), { status: 200 }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    const req = { symbol: "XAU/USD", interval: "4h", outputsize: 2000 };
    const all = await Promise.all([
      loadOhlcv(req),
      loadOhlcv(req),
      loadOhlcv(req),
      loadOhlcv(req),
      loadOhlcv(req),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(all.every((r) => r.candles.length > 0 && r.provider === "polygon")).toBe(true);

    // A later sequential consumer (Elliott/ICT/setups/MTF) reuses the cache.
    await loadOhlcv(req);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not hammer a 429 provider", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "ERROR", error: "rate limited" }), {
          status: 429,
          headers: { "retry-after": "60" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    for (let i = 0; i < 10; i++) {
      await loadOhlcv({ symbol: "XAU/USD", interval: "4h", outputsize: 300 + i });
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("skips providers that structurally cannot serve the request", () => {
    const env = {
      METALPRICE_API_KEY: "k",
      MASSIVE_API_KEY: "k",
      ALPHA_VANTAGE_API_KEY: "k",
      FMP_API_KEY: "k",
      TWELVEDATA_API_KEY: "k",
    };
    expect(resolveCascade("XAU/USD", "4h", env)).toEqual(["polygon", "twelvedata"]);
    expect(resolveCascade("XAU/USD", "1d", env)).toEqual([
      "metalpriceapi",
      "polygon",
      "alphavantage",
      "twelvedata",
    ]);
    expect(resolveCascade("EUR/USD", "1d", env)).toEqual([
      "polygon",
      "alphavantage",
      "twelvedata",
    ]);
  });
});
