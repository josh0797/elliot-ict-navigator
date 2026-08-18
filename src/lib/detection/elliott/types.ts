import type { PivotV2 } from "../schemas/analysis";
import type { ElliottDegree } from "./degrees";
import type { HypothesisKind, HypothesisScore } from "./hypotheses";
import type { TruncationEvidence } from "./truncation";

export type { ElliottDegree };
export type { HypothesisKind, HypothesisScore, TruncationEvidence };

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
  /** Independent scores for ABC / impulse / diagonal / truncated fifth. */
  hypotheses?: HypothesisScore[];
  /** Truncation evidence for the primary count (geometry stage). */
  truncation?: TruncationEvidence | null;
  /** Hypothesis kind chosen for the primary count. */
  scenarioKind?: HypothesisKind;
  /** Degree the count was computed at. */
  degree?: ElliottDegree;
  /** Number of pivots in the structural pool (diagnostics). */
  pivotsUsed?: number;
}

// ─── DTO (Phase 3 contract) ──────────────────────────────────────────────────

export type ElliottStatus =
  | "VALID"
  | "DEVELOPING"
  | "NEAR_COMPLETION"
  | "INVALIDATED"
  | "NO_COUNT"
  | "COMPLETED"
  | "STALE";
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
  /**
   * Lifecycle relative to the current price, assigned by
   * `scenarioConsistencyCheck`. HIT = reached/exceeded, ACTIVE = the nearest
   * unreached target, NEXT = the one after it, PENDING = further away.
   */
  state?: "HIT" | "ACTIVE" | "NEXT" | "PENDING";
}

/** Exhaustion evidence used to confirm the end of wave 5 (needs >= 2). */
export type ExhaustionSignalCode =
  | "FIB_TARGET_REACHED"
  | "RSI_DIVERGENCE"
  | "MACD_DIVERGENCE"
  | "MOMENTUM_LOSS"
  | "STRUCTURAL_REJECTION"
  | "COUNTER_BOS_CHOCH"
  | "INTERNAL_SWING_BREAK"
  | "FIVE_SUBWAVES";

export type ConsistencyIssueCode =
  | "INVALIDATION_BREACHED"
  | "ALL_TARGETS_EXCEEDED"
  | "TARGET_BELOW_PRICE"
  | "COMPLETED_WITHOUT_EVIDENCE"
  | "STATUS_TEXT_MISMATCH"
  | "STALE_SCENARIO"
  | "ALTERNATIVE_PROMOTED";

export interface ScenarioConsistency {
  /** Issues detected and already corrected before rendering. */
  issues: ConsistencyIssueCode[];
  corrected: boolean;
  /** Exhaustion evidence collected for the wave in progress. */
  exhaustion: ExhaustionSignalCode[];
  /** True when the scenario was retired (targets exceeded / invalidated). */
  stale: boolean;
  /** Price used to evaluate the scenario. */
  priceAtCheck: number;
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
  /**
   * Stable macro scenario identity (context timeframe + asOf + anchors).
   * Two execution timeframes sharing the same context must share this id.
   */
  scenarioId?: string | null;
  /** Elliott degree of this count. */
  degree?: ElliottDegree;
  /** Pivots used by the structural pool (diagnostics). */
  pivotsUsed?: number;
  /** Internal subdivision of a lower degree (diagnostic view). */
  internal?: ElliottResultDTO | null;
  completion: number;       // 0..1
  confidence: number;       // 0..100
  invalidationLevel: number | null;
  rules: ElliottRuleResult[];
  waves: ElliottWaveDTO[];
  alternatives: ElliottResultDTO[];
  breakdown?: ConfidenceBreakdown;
  /** Result of `scenarioConsistencyCheck` (set once price is known). */
  consistency?: ScenarioConsistency;
  /** Active Fibonacci target (nearest unreached), when any. */
  activeTarget?: FibTargetDTO | null;
  /** Target after the active one. */
  nextTarget?: FibTargetDTO | null;
  /** Targets already reached/exceeded by price. */
  hitTargets?: FibTargetDTO[];
  /** Hypothesis kind for this scenario (ABC / IMPULSE / DIAGONAL / …). */
  scenarioKind?: HypothesisKind;
  /** Independent hypothesis scores compared for this count. */
  hypotheses?: HypothesisScore[];
  /** Concrete truncated-fifth evidence (null when not applicable). */
  truncation?: TruncationEvidence | null;
  /** Engine diagnostics (why a hypothesis won/lost, corrections applied). */
  notes?: string[];
}