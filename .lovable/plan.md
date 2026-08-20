# XAU/USD market-data diagnosis (read-only) — 2026-08-20 20:28 UTC

No code, migrations, DB rows, crons, secrets or settings were touched. Secrets were used only to call the providers; no key values are shown.

## 1. Who serves XAU/USD (from `resolveCascade`, `src/lib/marketData/providers.server.ts:621`)

Keys present in this environment: METALPRICE_API_KEY, TWELVEDATA_API_KEY, FMP_API_KEY, ALPHA_VANTAGE_API_KEY, MASSIVE_API_KEY. Absent: POLYGON_API_KEY. Flags `ALPHA_VANTAGE_PREMIUM` and `FMP_LEGACY_ENABLED` are not set.

- `1day` / `1week`: `metalpriceapi` -> `polygon` (via MASSIVE_API_KEY) -> `alphavantage` -> `twelvedata`
- `1min / 15min / 1h / 4h`: `polygon` (MASSIVE) -> `twelvedata` (MetalPrice excluded by design: one rate per day; Alpha Vantage excluded without premium; FMP excluded, legacy opt-in off)

So the `metalpriceapi` badge on 1day is expected; intraday never uses MetalPrice for candles. Live quote (`livePriceFor`, line 745) is MetalPrice-only, for metals, 60s TTL.

## 2. MetalPriceAPI observed (own key)

- `/v1/latest` (base=XAU, currencies=USD): **HTTP 200**, `success:true`, `USD = 4520.82`, `timestamp 1787257615` (= now). Plausibly current. No rate/quota headers returned.
- `/v1/timeframe` 2026-08-14..2026-08-20: **HTTP 200**, ends at **2026-08-20 = 4514.08**; 2026-08-19 = **4341.83**. So the API *does* return today's row; it does not stop at prior close.
- `/v1/usage`: **HTTP 200**, plan `Professional`, used 868 / total 100000, remaining 99132. No quota pressure.
- Note: calls with a Python/urllib default UA got **HTTP 403 "error code 1010"** (edge/browser-signature block); the same calls via curl and via `fetch` (undici/bun, no UA) returned 200. Runtime `fetch` from the server is not blocked.

Key data-quality finding: MetalPrice's per-day `timeframe` rate is **not a daily close**. Its 08-19 value 4341.83 vs Twelve Data's 08-19 daily close 4523.25 differs by ~181 USD. The chart's `08-19 00:00Z · 4341.83` is therefore both (a) correctly the last *closed* daily bar after `dropOpenCandle` drops today's incomplete 1d bar, and (b) a wrong price for that day.

## 3. Twelve Data observed (own key, 3 calls total)

- `/api_usage`: 200 — `{"timestamp":"2026-08-20 20:27:45","current_usage":1,"plan_limit":144,"plan_category":"grow"}`; headers `Api-Credits-Used: 1`, `Api-Credits-Left: 143`.
- `/price?symbol=XAU/USD`: 200 — `4521.00005`; `Api-Credits-Used: 2`, `Api-Credits-Left: 142` (1 credit/symbol).
- `/time_series 1day`: 200 — 08-20 close 4520.90 (bar still open), 08-19 close 4523.25, 08-18 4335.68.

Twelve Data quota is essentially idle right now (1/144 at the moment of the check). The attached dashboard is indeed Twelve Data; its 8 "limit exceeded" events reflect past bursts (large `outputsize` history pulls and M1 pre-raid capture), not a currently exhausted plan.

## 4. Effective throttles / caches (exact names)

- `DEFAULT_POLICIES` (`src/lib/marketData/limiter.ts:86`): metalpriceapi 10/min, minInterval 1000 ms, baseCooldown 60 s; twelvedata 8/min, 1000 ms, 60 s; polygon 30/min, 250 ms, 30 s; alphavantage 5/min; fmp 10/min. Breaker backoff doubles per consecutive failure, cap 15 min (`maxCooldownMs`), quota failures floor at 5 min.
- OHLC TTL: `ttlForTimeframe` (`async-cache.ts:83`) — 1m 20 s, 5m 45 s, 15m 90 s, 30m 150 s, 1h 300 s, 4h 900 s, 1d 1800 s, 1w 3600 s. Cache key `provider:SYMBOL:timeframe:limit` (`ohlcvKey`), with request coalescing.
- Live-price TTL: hardcoded `60_000` in `livePriceFor` (`providers.server.ts:750`), separate `livePriceCache`.
- Client side: `src/lib/chart/cache.ts` `DEFAULT_TTL_MS = 60_000`; chart auto-refresh `window.setInterval(load, 60_000)` (`chart.$symbol.tsx:360`).
- **Scope**: `ohlcvCache`, `livePriceCache` and `guards` are module-level singletons (`providers.server.ts:598-600`, `743`) — per Worker isolate, **not** globally persistent. Multiple/recycled isolates each get their own counters, so the 8/min Twelve Data cap is not a global guarantee; that is the mechanism behind observed upstream 429s.

## 5. Is `livePrice` rendered? No.

`snapshot.livePrice` is produced by `loadOhlcv`, typed in `AnalysisSnapshot` (`src/lib/chart/snapshot.ts:40`) and assigned at `chart.$symbol.tsx:243` — and then **never read anywhere**. Grep across `src/` shows no consumer in `TradingChart.tsx` or any component. The header badge prints only `snapshot.candles.at(-1).close` and `lastClosedCandleTime` (`chart.$symbol.tsx:414-431`). The MetalPrice live quote (4520.82, current) is fetched every minute and discarded.

## 6. Logs

`/tmp/dev-server-logs/dev-server.log` contains no `[mkt ...]` `logDataEvent` lines and no 429/circuit-open entries for this session (nothing matched `429|rate|circuit|quota|stale`). Production Worker logs are not readable from here, so no runtime 429 evidence could be collected for the deployed app.

## 7. Ranked root cause

1. **UI/staleness perception + dead live quote (primary).** On 1day the last *closed* bar is by definition yesterday 00:00Z, and the header shows only that closed close. The current price is already in memory (`livePrice`) but not rendered — so a correct system looks 20 h stale.
2. **MetalPrice daily series is not daily closes (real data defect).** `/v1/timeframe` returns one snapshot rate per day; 08-19 = 4341.83 vs the true 08-19 close 4523.25. Any 1day Elliott/Fibonacci work on XAU/USD is running on distorted OHLC (open = previous rate, high/low = envelope, all synthetic — see `fetchMetalPrice`).
3. **Twelve Data quota/rate limiting (secondary, historical).** Plan is Grow 144 credits/min and is idle now (1/144). The 8 limit-exceeded events came from bursts; the in-process 8/min guard is per isolate and can be exceeded across isolates. Not the cause of today's stale-looking 1day chart.
4. MetalPrice quota/edge blocking: not a factor (868/100000 used; 200 from runtime fetch). The 403/1010 seen with a Python UA is a client-signature artifact only.

## 8. Safest fix (recommended, NOT implemented)

1. **Render the live quote.** In the chart header show `snapshot.livePrice` as the current price (labelled live/spot) next to the existing closed-bar badge — presentation-only, no engine change. This alone resolves the reported symptom.
2. **Fix 1day price truth for metals.** Prefer a true-OHLC provider for `1d`/`1w` XAU/USD (Twelve Data `1day` verified correct today) and demote `metalpriceapi` to live-quote duty only, or keep it as last-resort fallback. Change limited to `resolveCascade` ordering; do not blend series.
3. **Do not increase polling to 60 calls/minute.**
   - MetalPrice: `/latest` is a spot snapshot whose refresh cadence is plan-bound, and `/timeframe` publishes one rate per day. 60/min would burn ~86k requests/day (plan total 100k) and mostly return the same value. Keep the existing 60 s `livePriceCache` TTL.
   - Twelve Data `/price`: 1 credit per call, so 60/min = 60 of 144 credits/min just for one quote — technically allowed but it competes with history/M1 capture that already triggered limit-exceeded events, for a quote that barely moves within a minute.
   - Neither provider needs 60/min. If a snappier live number is wanted, 15–30 s for the single live quote is the ceiling worth considering; the OHLC TTLs should stay as they are.
4. **Optional hardening:** make the per-provider guard state resilient to isolate churn (or lower the effective Twelve Data burst on large `outputsize` pulls) to stop the recurring upstream 429s.
