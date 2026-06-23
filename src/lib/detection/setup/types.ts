import type { ElliottResultDTO } from "../elliott/types";
import type { OperationalReport } from "../decision/types";

export type SignalDirection = "long" | "short";

export type SignalConfluence =
  | "BIAS_ALIGN"
  | "WAVE_ENTRY_ZONE"
  | "OB_CONFLUENCE"
  | "FVG_CONFLUENCE"
  | "SWEEP_RECENT"
  | "STRUCTURE_CONFIRMED"
  | "PD_ALIGNED"
  | "KILLZONE_ACTIVE";

export interface ScoreBreakdown {
  elliott: number;
  ict: number;
  confluence: number;
}

/**
 * Canonical setup contract v2. Independent of the legacy `TradeSetup` shape;
 * the legacy ML adapter consumes this through an explicit mapper.
 */
export type OrderType =
  | "BUY_LIMIT" | "SELL_LIMIT"
  | "BUY_STOP"  | "SELL_STOP"
  | "MARKET_BUY" | "MARKET_SELL"
  | "NO_ORDER";

export type SetupStatus =
  | "READY"
  | "WAITING_RETRACE"
  | "TRIGGERED"
  | "INVALIDATED"
  | "NO_SETUP";

export interface SLBasis {
  elliottInvalidation: number | null;
  poiExtreme: number;
  sweepExtreme: number | null;
  protectedSwing: number | null;
  atrBuffer: number;
  /** Side of the aggregation: long → `min`, short → `max`. */
  chosen: "max" | "min";
}

export type Tp1Source =
  | { kind: "LIQUIDITY"; liquidityId: string; price: number }
  | { kind: "FALLBACK"; fallback: "2R" };

export type Tp2Source =
  | {
      kind: "FIB_EXTENSION";
      wave: string;        // e.g. "3", "5", "C"
      from: number;        // leg origin price
      to: number;          // leg end price
      projectedFrom: number;
      ratio: 1.618;
    }
  | { kind: "FALLBACK"; fallback: "3R" };

export interface PoiSnapshot {
  kind: "ORDER_BLOCK" | "FVG";
  id: string;
  proximal: number;
  distal: number;
  state: string;
}

export interface TradeSetupV2 {
  schemaVersion: "canonical-setup-v2";
  id: string;
  symbol: string;
  timeframe: string;
  direction: SignalDirection;

  orderType: OrderType;
  status: SetupStatus;

  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rrToTp1: number;
  rrToTp2: number;

  /** Close of the last confirmed candle at detection — frozen on the snapshot. */
  priceAtDetection: number;

  slBasis: SLBasis;
  tp1Source: Tp1Source;
  tp2Source: Tp2Source;
  poi: PoiSnapshot;

  /** 0..1 canonical score from confluences. */
  score: number;
  /** 0..1 frozen legacy ML probability — ACTIVE BASELINE, diagnostic only. */
  mlScore: number | null;
  modelVersion: string | null;

  breakdown: ScoreBreakdown;
  confluences: SignalConfluence[];
  gatesPassed: string[];

  waveLabel: string | null;
  rationale: string;
  detectedAt: number;
}

/** UI alias — every consumer treats setups as immutable snapshots. */
export type TradeSignal = TradeSetupV2 & {
  /** Legacy UI fields preserved as aliases. */
  finalScore: number;
  poiKind: "ORDER_BLOCK" | "FVG";
  poiId: string;
};

export interface DetectSetupsResult {
  symbol: string;
  timeframe: string;
  signals: TradeSignal[];
  elliott: ElliottResultDTO;
  decision: OperationalReport;
  provider?: "polygon" | "twelvedata" | "none";
  error?: string;
}