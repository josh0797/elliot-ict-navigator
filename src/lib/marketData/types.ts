/** Client-safe market-data contracts (types only — no runtime code). */
import type { DataStatus, Freshness } from "./freshness";

export type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type MarketProvider =
  | "metalpriceapi"
  | "fmp"
  | "alphavantage"
  | "polygon"
  | "twelvedata"
  | "none";

export interface DataMeta {
  provider: MarketProvider;
  interval: string;
  intervalSeconds: number;
  /** UTC epoch seconds of the last CLOSED candle. */
  lastCandleTime: number;
  lastCandleIso: string;
  lastClose: number;
  /** Seconds between now and the last closed candle open time. */
  ageSeconds: number;
  /** True when data lags more than one full interval beyond the expected bar. */
  stale: boolean;
  candles: number;
  /** Full freshness verdict (tolerance, market session, reason). */
  freshness: Freshness;
}

export interface OhlcvResponse {
  candles: Candle[];
  provider: MarketProvider;
  /** Freshness contract for the snapshot (last CLOSED candle). */
  meta?: DataMeta;
  /** OK, or DATA_STALE when no provider served a fresh series. */
  status: DataStatus;
  /** Live quote from the primary provider — never merged into the series. */
  livePrice?: number | null;
  /** UTC epoch seconds the snapshot was taken at. */
  asOf: number;
  error?: string;
}
