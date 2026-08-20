/**
 * Client-safe provider-preference contract (no secrets, no I/O).
 *
 * The user can pin the chart OHLC source. `auto` keeps the corrected cascade
 * (see `resolveCascade`); any explicit choice is used EXCLUSIVELY for that
 * request — never blended and never silently replaced by another provider.
 */

export const PROVIDER_PREFERENCES = [
  "auto",
  "polygon",
  "twelvedata",
  "alphavantage",
  "metalpriceapi",
] as const;

export type ProviderPreference = (typeof PROVIDER_PREFERENCES)[number];

export const PROVIDER_LABELS: Record<ProviderPreference, string> = {
  auto: "Auto",
  polygon: "Massive / Polygon",
  twelvedata: "Twelve Data",
  alphavantage: "Alpha Vantage",
  metalpriceapi: "MetalPrice",
};

export const PROVIDER_NOTES: Record<ProviderPreference, string> = {
  auto: "Cascada corregida: intradía Massive/Polygon → Twelve Data; metales 1day/1week Twelve Data primero.",
  polygon: "Fuente intradía principal (Massive/Polygon).",
  twelvedata: "OHLC real; consume créditos del plan.",
  alphavantage: "Intradía FX requiere plan premium; diario disponible en plan gratuito.",
  metalpriceapi:
    "Solo 1day/1week de metales · OHLC SINTÉTICO (fallback). No sirve intradía. Independiente del precio spot LIVE.",
};

const METAL_BASES = new Set(["XAU", "XAG", "XPT", "XPD"]);

/** True for every timeframe below 1 day. */
export function isIntradayTimeframe(interval: string): boolean {
  const i = interval.toLowerCase();
  return !(
    i === "1d" ||
    i === "1day" ||
    i === "1w" ||
    i === "1week" ||
    i === "1m" ||
    i === "1month"
  );
}

export function isMetalSymbol(symbol: string): boolean {
  return METAL_BASES.has(symbol.toUpperCase().split("/")[0] ?? "");
}

export interface ProviderSupport {
  ok: boolean;
  /** User-facing Spanish explanation when `ok` is false. */
  reason?: string;
}

/**
 * Structural (key-independent) support check. Availability of API keys is
 * resolved server-side; this only encodes what a provider can serve at all.
 */
export function providerSupports(
  preference: ProviderPreference,
  symbol: string,
  interval: string,
): ProviderSupport {
  if (preference === "auto") return { ok: true };
  if (preference === "metalpriceapi") {
    if (isIntradayTimeframe(interval)) {
      return {
        ok: false,
        reason: "MetalPrice no sirve datos intradía: solo 1day/1week (OHLC sintético).",
      };
    }
    if (!isMetalSymbol(symbol)) {
      return { ok: false, reason: "MetalPrice solo cubre metales (XAU, XAG, XPT, XPD)." };
    }
  }
  return { ok: true };
}

export function isProviderPreference(value: unknown): value is ProviderPreference {
  return typeof value === "string" && (PROVIDER_PREFERENCES as readonly string[]).includes(value);
}
