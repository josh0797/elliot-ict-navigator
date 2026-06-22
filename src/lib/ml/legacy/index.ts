// Public surface for the legacy frozen scorer.
// NOT wired into the operational pipeline. Use only for shadow logging
// or side-by-side comparison against canonical-ict-v2.

import { PRETRAINED } from "./pretrained";
import { extractLegacyFeatures, type LegacyInput, LEGACY_FEATURE_ORDER } from "./features";
import { predictLegacy } from "./mlp";

export const LEGACY_SCHEMA = "legacy-pretrained-html-v1" as const;

export const LEGACY_WARNINGS = [
  "fvg_size is an R-multiple proxy, not a real FVG measurement",
  "atr_norm is sl/entry, not Wilder ATR",
  "is_killzone is constant 0.5 in training schema",
  "score is a heuristic blend of rrNorm and hasAlternative",
  "dist_ob measures price↔confirmation, not an Order Block",
  "wave_code introduces artificial ordinality between Elliott waves",
  "target has post-hoc lookahead bias from evaluate_results.py fallback",
  "accuracy_test = 52.86% (baseline win-rate = 49.71%)",
] as const;

export const LEGACY_METADATA = {
  schema: LEGACY_SCHEMA,
  status: "TRAINING_SCHEMA_VERIFIED",
  trainedAt: PRETRAINED.trainedAt,
  samples: PRETRAINED.samples,
  accuracyTest: PRETRAINED.accuracy_test,
  winRateDataset: PRETRAINED.win_rate_dataset,
  featureOrder: LEGACY_FEATURE_ORDER,
  minNorm: PRETRAINED.minNorm,
  maxNorm: PRETRAINED.maxNorm,
  warnings: LEGACY_WARNINGS,
} as const;

export type LegacyScoreResult = {
  schema: typeof LEGACY_SCHEMA;
  probability: number;
  features: { raw: number[]; normalized: number[] };
  warnings: string[];
  metadata: typeof LEGACY_METADATA;
};

export function scoreLegacy(input: LegacyInput): LegacyScoreResult {
  const feats = extractLegacyFeatures(input);
  const probability = predictLegacy(feats.normalized);
  return {
    schema: LEGACY_SCHEMA,
    probability,
    features: { raw: feats.raw, normalized: feats.normalized },
    warnings: feats.warnings,
    metadata: LEGACY_METADATA,
  };
}

export { extractLegacyFeatures, LEGACY_FEATURE_ORDER } from "./features";
export type { LegacyInput, LegacyFeatures } from "./features";
export { predictLegacy, LEGACY_SHAPES, LEGACY_WEIGHT_MATRICES } from "./mlp";
export { PRETRAINED } from "./pretrained";