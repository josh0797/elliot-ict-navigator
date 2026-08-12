import type { PivotV2 } from "../schemas/analysis";

export type WaveLabel =
  | "0" | "1" | "2" | "3" | "4" | "5"
  | "A" | "B" | "C"
  | "W" | "X" | "Y" | "Z";

export type WavePattern =
  | "IMPULSE"
  | "LEADING_DIAGONAL"
  | "ENDING_DIAGONAL"
  | "ZIGZAG"
  | "FLAT"
  | "DOUBLE_ZIGZAG"
  | "TRIPLE_ZIGZAG"
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

// ─── DTO (Phase 3 contract) ──────────────────────────────────────────────────

export type ElliottStatus = "VALID" | "DEVELOPING" | "INVALIDATED" | "NO_COUNT" | "COMPLETED";
export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type RuleStatus = "PASS" | "FAIL" | "PENDING";

export type ElliottRuleCode =
  | "W2_ORIGIN"
  | "W3_NOT_SHORTEST"
  | "W4_OVERLAP"
  | "W2_RETRACE"
  | "W3_EXTENSION"
  | "W4_ALTERNATION"
  | "W5_PROJECTION";

export interface ElliottRuleResult {
  code: ElliottRuleCode;
  status: RuleStatus;
  message: string;
}

export interface ElliottWaveDTO {
  label: WaveLabel;
  index: number;
  time: string; // ISO-8601
  price: number;
  type: "HIGH" | "LOW";
  confirmed: boolean;
}

export interface FibTargetDTO {
  /** Human label, e.g. "W3 1.618" or "W2 0.618 retr". */
  label: string;
  ratio: number;
  price: number;
  kind: "RETRACEMENT" | "EXTENSION" | "PROJECTION";
}

export interface ConfidenceBreakdown {
  mandatoryRules: number;   // 0..25
  alternation: number;      // 0..20
  fibonacci: number;        // 0..20
  pivotClarity: number;     // 0..15
  timeDuration: number;     // 0..10
  marketStructure: number;  // 0..10
}

export interface ElliottResultDTO {
  status: ElliottStatus;
  bias: Bias;
  pattern: WavePattern;
  currentWave: WaveLabel | null;
  /** Wave the market is expected to develop next (null when unknown). */
  nextWave: WaveLabel | null;
  /** Narrative of what the count implies and what confirms/kills it. */
  scenario?: string;
  /** Price that confirms the next wave (break of the relevant extreme). */
  confirmationLevel?: number | null;
  /** Fibonacci projections/retracements for the active wave. */
  fibTargets?: FibTargetDTO[];
  /** Timeframe the count was computed on. */
  timeframe?: string;
  completion: number;       // 0..1
  confidence: number;       // 0..100
  invalidationLevel: number | null;
  rules: ElliottRuleResult[];
  waves: ElliottWaveDTO[];
  alternatives: ElliottResultDTO[];
  breakdown?: ConfidenceBreakdown;
}