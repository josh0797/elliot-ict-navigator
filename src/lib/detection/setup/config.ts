/**
 * Setup engine configuration — all thresholds, weights and allocations
 * live here. Override per call via `SetupConfig` partial.
 */

export interface ScoreWeights {
  ELLIOTT_ALIGNED: number;
  ICT_BIAS_ALIGNED: number;
  SWEEP_OPPOSITE_RECENT: number;
  CHOCH_CONFIRMED: number;
  BOS_DISPLACEMENT: number;
  OB_VALID: number;
  FVG_VALID: number;
  OB_FVG_INTERSECTION: number;
  PD_ALIGNED: number;
  KILLZONE_ACTIVE: number;
  HTF_ALIGNED: number;
}

export interface TargetAllocations {
  TP1: number;
  TP2: number;
  TP3: number;
}

export interface SetupConfig {
  minimumRiskReward: number;
  preferredRiskReward: number;
  slAtrBufferMultiplier: number;
  buyScoreThreshold: number;
  watchScoreThreshold: number;
  weights: ScoreWeights;
  allocations: TargetAllocations;
  recentBars: number;
  topN: number;
}

export const DEFAULT_CONFIG: SetupConfig = {
  minimumRiskReward: 1.5,
  preferredRiskReward: 2.0,
  slAtrBufferMultiplier: 0.10,
  buyScoreThreshold: 70,
  watchScoreThreshold: 45,
  weights: {
    ELLIOTT_ALIGNED: 15,
    ICT_BIAS_ALIGNED: 10,
    SWEEP_OPPOSITE_RECENT: 15,
    CHOCH_CONFIRMED: 15,
    BOS_DISPLACEMENT: 10,
    OB_VALID: 10,
    FVG_VALID: 10,
    OB_FVG_INTERSECTION: 5,
    PD_ALIGNED: 5,
    KILLZONE_ACTIVE: 3,
    HTF_ALIGNED: 2,
  },
  allocations: { TP1: 50, TP2: 30, TP3: 20 },
  recentBars: 15,
  topN: 3,
};

export function resolveConfig(partial?: Partial<SetupConfig>): SetupConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    weights: { ...DEFAULT_CONFIG.weights, ...(partial?.weights ?? {}) },
    allocations: { ...DEFAULT_CONFIG.allocations, ...(partial?.allocations ?? {}) },
  };
}

export function gradeFromScore(score: number): "A+" | "A" | "B" | "C" | "WATCH" | "NO_TRADE" {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "WATCH";
  return "NO_TRADE";
}