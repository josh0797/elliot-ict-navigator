/**
 * Catalog of tradable instruments supported by the platform.
 * Mirrors the multi-asset picker from the reference UI (forex + crypto + metals).
 * Symbol format is the canonical flat ticker with a single "/" separator.
 */

export type AssetGroup = "Forex" | "Crypto" | "Metals";

export interface SymbolEntry {
  symbol: string;
  label: string;
  group: AssetGroup;
}

export const SYMBOL_CATALOG: ReadonlyArray<SymbolEntry> = [
  // Forex majors / minors
  { symbol: "EUR/USD", label: "EUR/USD · Euro / US Dollar",        group: "Forex" },
  { symbol: "GBP/USD", label: "GBP/USD · Pound / US Dollar",       group: "Forex" },
  { symbol: "USD/JPY", label: "USD/JPY · US Dollar / Yen",         group: "Forex" },
  { symbol: "USD/CAD", label: "USD/CAD · US Dollar / Canadian",    group: "Forex" },
  { symbol: "AUD/USD", label: "AUD/USD · Aussie / US Dollar",      group: "Forex" },
  { symbol: "USD/CHF", label: "USD/CHF · US Dollar / Swiss Franc", group: "Forex" },
  { symbol: "NZD/USD", label: "NZD/USD · Kiwi / US Dollar",        group: "Forex" },
  { symbol: "GBP/AUD", label: "GBP/AUD · Pound / Aussie",          group: "Forex" },
  { symbol: "USD/MXN", label: "USD/MXN · US Dollar / Mexican Peso", group: "Forex" },
  // Metals
  { symbol: "XAU/USD", label: "XAU/USD · Gold",                    group: "Metals" },
  { symbol: "XAG/USD", label: "XAG/USD · Silver",                  group: "Metals" },
  // Crypto
  { symbol: "BTC/USD", label: "BTC/USD · Bitcoin",                 group: "Crypto" },
  { symbol: "ETH/USD", label: "ETH/USD · Ethereum",                group: "Crypto" },
  { symbol: "SOL/USD", label: "SOL/USD · Solana",                  group: "Crypto" },
  { symbol: "XRP/USD", label: "XRP/USD · XRP",                     group: "Crypto" },
  { symbol: "LTC/USD", label: "LTC/USD · Litecoin",                group: "Crypto" },
  { symbol: "TON/USD", label: "TON/USD · Toncoin",                 group: "Crypto" },
];

export function groupSymbols(): Record<AssetGroup, SymbolEntry[]> {
  const out = { Forex: [] as SymbolEntry[], Metals: [] as SymbolEntry[], Crypto: [] as SymbolEntry[] };
  for (const s of SYMBOL_CATALOG) out[s.group].push(s);
  return out;
}

export const HISTORY_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "200 candles",  value: 200 },
  { label: "500 candles",  value: 500 },
  { label: "1000 candles", value: 1000 },
  { label: "2000 candles", value: 2000 },
];