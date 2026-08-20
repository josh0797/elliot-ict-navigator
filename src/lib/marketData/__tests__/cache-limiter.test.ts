import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AsyncCache, ohlcvKey, ttlForTimeframe } from "../async-cache";
import {
  ProviderGuard,
  GuardRegistry,
  parseRetryAfter,
  DEFAULT_POLICIES,
} from "../limiter";

describe("AsyncCache coalescing", () => {
  it("shares one upstream call across concurrent identical requests", async () => {
    const cache = new AsyncCache();
    const upstream = vi.fn(async () => "candles");
    const key = ohlcvKey({ provider: "polygon", symbol: "XAU/USD", timeframe: "4h", limit: 2000 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => cache.resolve(key, 60_000, upstream)),
    );
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.outcome === "MISS")).toHaveLength(1);
    expect(results.every((r) => r.value === "candles")).toBe(true);
  });

  it("serves HIT inside TTL and refetches after expiry", async () => {
    let now = 0;
    const cache = new AsyncCache(() => now);
    const upstream = vi.fn(async () => now);
    await cache.resolve("k", 1000, upstream);
    now = 500;
    expect((await cache.resolve("k", 1000, upstream)).outcome).toBe("HIT");
    now = 2000;
    expect((await cache.resolve("k", 1000, upstream)).outcome).toBe("MISS");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("gives longer TTL to higher timeframes", () => {
    expect(ttlForTimeframe("15m")).toBeLessThan(ttlForTimeframe("4h"));
    expect(ttlForTimeframe("4h")).toBeLessThan(ttlForTimeframe("1d"));
  });
});

describe("ProviderGuard", () => {
  it("stops retrying a rate-limited provider and honours Retry-After", () => {
    let now = 0;
    const g = new ProviderGuard(
      "twelvedata",
      { maxPerMinute: 100, baseCooldownMs: 30_000 },
      () => now,
    );
    expect(g.tryAcquire().ok).toBe(true);
    g.onFailure("rate_limited", 120_000);
    for (let i = 0; i < 30; i++) {
      const a = g.tryAcquire();
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.reason).toBe("CIRCUIT_OPEN");
      now += 1_000;
    }
    now = 121_000;
    expect(g.tryAcquire().ok).toBe(true);
  });

  it("backs off exponentially on consecutive failures", () => {
    const now = 0;
    const g = new ProviderGuard("polygon", { maxPerMinute: 100, baseCooldownMs: 1_000 }, () => now);
    g.onFailure("error");
    expect(g.cooldownRemainingMs()).toBe(1_000);
    g.onFailure("error");
    expect(g.cooldownRemainingMs()).toBe(2_000);
    g.onFailure("error");
    expect(g.cooldownRemainingMs()).toBe(4_000);
    g.onSuccess();
    expect(g.cooldownRemainingMs()).toBe(0);
  });

  it("enforces per-minute quota", () => {
    let now = 0;
    const g = new ProviderGuard("av", { maxPerMinute: 2 }, () => now);
    expect(g.tryAcquire().ok).toBe(true);
    expect(g.tryAcquire().ok).toBe(true);
    const denied = g.tryAcquire();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("RATE_LIMIT");
    now = 61_000;
    expect(g.tryAcquire().ok).toBe(true);
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(new Date(1_000_000 + 5_000).toUTCString(), 1_000_000)).toBeGreaterThan(
      0,
    );
  });

  it("registry reuses one guard per provider", () => {
    const reg = new GuardRegistry();
    expect(reg.get("polygon")).toBe(reg.get("polygon"));
  });
});

describe("DEFAULT_POLICIES", () => {
  it("caps Twelve Data at 60 upstream calls/min with 1s spacing (Grow limit is 144 credits/min)", () => {
    expect(DEFAULT_POLICIES["twelvedata"].maxPerMinute).toBe(60);
    expect(DEFAULT_POLICIES["twelvedata"].minIntervalMs).toBe(1_000);
  });

  it("keeps MetalPrice conservative (quote refreshes ~60s; requests are billed)", () => {
    expect(DEFAULT_POLICIES["metalpriceapi"].maxPerMinute).toBe(10);
  });

  it("enforces the Twelve Data 1s spacing and 60/min ceiling at runtime", () => {
    let now = 0;
    const g = new ProviderGuard("twelvedata", DEFAULT_POLICIES["twelvedata"], () => now);
    expect(g.tryAcquire().ok).toBe(true);
    now += 500;
    expect(g.tryAcquire().ok).toBe(false); // spacing
    // Inside a single rolling minute the ceiling is 60 acquisitions.
    let granted = 1;
    while (now < 59_000) {
      now += 100;
      if (g.tryAcquire().ok) granted += 1;
    }
    expect(granted).toBeLessThanOrEqual(60);
    expect(granted).toBeGreaterThanOrEqual(55);
  });
});
