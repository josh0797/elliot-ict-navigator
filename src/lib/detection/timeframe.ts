/**
 * Canonical timeframe normalization.
 *
 * The app accepts user/provider-style timeframes (`"15min"`, `"1hour"`,
 * `"daily"`, etc.) but every internal module (liquidity, structure,
 * setup engine) expects a single canonical alphabet:
 *
 *   1m  2m  3m  5m  10m  15m  30m  45m
 *   1h  2h  3h  4h  6h  8h  12h
 *   1d  1w  1M
 *
 * Always pass user input through `normalizeTimeframe()` before forwarding
 * it to a detection module. Never branch on a raw provider string.
 */

const ALIASES: Record<string, string> = {
  "1min": "1m",
  "2min": "2m",
  "3min": "3m",
  "5min": "5m",
  "10min": "10m",
  "15min": "15m",
  "30min": "30m",
  "45min": "45m",
  "60min": "1h",
  "1hour": "1h",
  "2hour": "2h",
  "4hour": "4h",
  "1day": "1d",
  "daily": "1d",
  "1week": "1w",
  "weekly": "1w",
  "1month": "1M",
  "monthly": "1M",
};

const INTRADAY = new Set([
  "1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m",
  "60m", "1h", "2h", "3h", "4h", "6h", "8h", "12h",
]);

export function normalizeTimeframe(value: string | undefined | null): string {
  if (!value) return "";
  const k = value.trim().toLowerCase();
  return ALIASES[k] ?? k;
}

export function isIntradayTimeframe(value: string | undefined | null): boolean {
  if (!value) return true; // back-compat: assume intraday when unspecified
  return INTRADAY.has(normalizeTimeframe(value));
}