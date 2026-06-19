import type { PivotV2 } from "../schemas/analysis";

export type WaveLabel = "0" | "1" | "2" | "3" | "4" | "5" | "A" | "B" | "C";

export type WavePattern =
  | "IMPULSE"
  | "LEADING_DIAGONAL"
  | "ENDING_DIAGONAL"
  | "ZIGZAG"
  | "FLAT"
  | "SIMPLE_CORRECTION"
  | "UNKNOWN_CORRECTION";

export type CountState =
  | "NO_COUNT"
  | "DEVELOPING"
  | "VALID"
  | "INVALIDATED"
  | "COMPLETED";

export interface LabeledPivot {
  pivot: PivotV2;
  label: WaveLabel;
}

export interface FibScores {
  wave2Retracement: number | null;
  wave3Extension: number | null;
  wave4Retracement: number | null;
  wave5Projection: number | null;
}

export interface ElliottCountV2 {
  direction: "long" | "short";
  pattern: WavePattern;
  state: CountState;
  labeled: LabeledPivot[];
  currentWave: WaveLabel | null;
  score: number;
  fibScores: FibScores;
  alternation: number | null;
  invalidations: string[];
  notes: string[];
}

export interface ElliottAnalysis {
  primary: ElliottCountV2 | null;
  alternatives: ElliottCountV2[];
}