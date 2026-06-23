import type { ElliottResultDTO } from "../elliott/types";

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

export interface TradeSignal {
  id: string;
  symbol: string;
  timeframe: string;
  direction: SignalDirection;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  /** Same as `entry` — kept explicit for the legacy adapter contract. */
  confirmationLevel: number;
  /** Same as `sl` — kept explicit for the legacy adapter contract. */
  invalidationLevel: number;
  /**
   * Target used as `fibTarget1` in the legacy extractor.
   * Aligned with `rrToTp1` (same target as `rrRatio`) so the legacy feature
   * vector stays internally consistent (f0 and f3 reference TP1).
   */
  fibTarget1: number;
  rrToTp1: number;
  rrToTp2: number;
  /**
   * Close of the last confirmed candle at the moment the signal was created.
   * Frozen into the snapshot so re-scoring the same signal yields the same
   * legacy probability regardless of live price drift.
   */
  priceAtDetection: number;
  /** 0..1 canonical score from confluences. */
  score: number;
  /**
   * 0..1 frozen legacy ML probability, or null if unavailable.
   * ACTIVE BASELINE — parallel diagnostic only, not an operational gate.
   */
  mlScore: number | null;
  modelVersion: string | null;
  /**
   * 0..1 operational score. Currently equal to canonical `score`; the legacy
   * ML weight is 0 until backtest justifies a calibrated blend.
   */
  finalScore: number;
  breakdown: ScoreBreakdown;
  confluences: SignalConfluence[];
  poiKind: "ORDER_BLOCK" | "FVG";
  poiId: string;
  waveLabel: string | null;
  rationale: string;
  detectedAt: number;
}

export interface DetectSetupsResult {
  symbol: string;
  timeframe: string;
  signals: TradeSignal[];
  elliott: ElliottResultDTO;
  provider?: "polygon" | "twelvedata" | "none";
  error?: string;
}