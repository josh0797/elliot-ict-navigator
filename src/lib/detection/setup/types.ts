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
  /** Fib 1.618 target used as `fibTarget1` in the legacy extractor. */
  fibTarget1: number;
  rrToTp1: number;
  rrToTp2: number;
  /** 0..1 canonical score from confluences. */
  score: number;
  /** 0..1 frozen legacy ML probability, or null if unavailable. */
  mlScore: number | null;
  modelVersion: string | null;
  /** 0..1 blended score (0.6*score + 0.4*mlScore). */
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