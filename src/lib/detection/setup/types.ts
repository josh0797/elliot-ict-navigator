import type { ElliottResultDTO } from "../elliott/types";
import type { OperationalReport } from "../decision/types";
import type { SelectedPOI } from "./poi-selector";
import type { SetupTrigger } from "./trigger";
import type { StopReason } from "./risk";
import type { TargetSpec } from "./targets";
import type { ConfluenceAudit } from "./scoring";

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
  setupKey: string;
  symbol: string;
  timeframe: string;
  direction: SignalDirection;
  /** Uppercase form per Phase-13 contract; mirrors `direction`. */
  directionUpper: "LONG" | "SHORT";

  orderType: OrderType;
  status: SetupStatus;

  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rrToTp1: number;
  rrToTp2: number;

  /** Phase-9 entry policy. */
  entryZone: { top: number; bottom: number };
  entryPolicy: "POI_MIDPOINT" | "FVG_CE" | "OB_PROXIMAL" | "OB_FVG_INTERSECTION";

  /** Phase-10 SL reason classification. */
  stopReason: StopReason;

  /** Phase-11 target ladder (TP1/TP2/TP3). */
  targets: TargetSpec[];

  /** Phase-6 POI snapshot — richer than legacy `poi`. */
  selectedPoi: SelectedPOI | null;

  /** Phase-7 explicit user-actionable trigger. */
  trigger: SetupTrigger | null;

  /** Close of the last confirmed candle at detection — frozen on the snapshot. */
  priceAtDetection: number;

  slBasis: SLBasis;
  tp1Source: Tp1Source;
  tp2Source: Tp2Source;
  poi: PoiSnapshot;

  /** Legacy 0..1 canonical score alias (= scoreOut100/100). */
  score: number;
  /** Phase-12 canonical score 0..100. */
  scoreOut100: number;
  grade: "A+" | "A" | "B" | "C" | "WATCH" | "NO_TRADE";
  hardBlockers: string[];
  warnings: string[];

  /** 0..1 frozen legacy ML probability — ACTIVE BASELINE, diagnostic only. */
  mlScore: number | null;
  modelVersion: string | null;

  breakdown: ScoreBreakdown;
  confluences: SignalConfluence[];
  /** Per-weight audit driving `scoreOut100`. */
  confluencesDetail: ConfluenceAudit[];
  gatesPassed: string[];

  waveLabel: string | null;
  rationale: string;
  /** Single-sentence user instruction (e.g. "Esperar barrido SSL 1.13820"). */
  nextAction: string;
  /** Setup invalidation level + human reason. */
  invalidation: { price: number | null; reason: string | null };
  detectedAt: number;
  /** Optional expiry timestamp (e.g. for pending limit orders). */
  expiresAt: number | null;
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