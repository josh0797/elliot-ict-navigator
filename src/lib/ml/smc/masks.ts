/**
 * Operative feature masks for the SMC_M30 family.
 *
 * The raw schema (`SMC_FEATURE_NAMES`, 41 columns) is FROZEN: masks never
 * delete, rename or reorder it — they only project a subset of columns.
 *
 * `SMC_OPERATIVE_V1` is the 22-column entry-time subset validated in the
 * Phase 1.5 read-only study. Notably `sweep_quality_norm` is deliberately
 * EXCLUDED: the canonical sweep quality score folds in `displacementAfter`,
 * which is post-entry information.
 */
import { SMC_FEATURE_NAMES, type SmcFeatureName } from "./features";

export const SMC_OPERATIVE_MASK_NAME = "SMC_OPERATIVE_V1" as const;
export const SMC_OPERATIVE_MASK_VERSION = 1 as const;

export const SMC_OPERATIVE_V1 = [
  "london_minute_sin",
  "london_minute_cos",
  "minutes_from_m30_norm",
  "in_first_15m_after_m30",
  "session_london_pre",
  "session_london",
  "range_over_atr",
  "range_expansion_over_atr",
  "atr_fast_slow_ratio",
  "body_over_range",
  "upper_wick_over_range",
  "lower_wick_over_range",
  "velocity3_over_atr",
  "velocity5_over_atr",
  "acceleration_over_atr",
  "sweep_ssl_recent",
  "sweep_bsl_recent",
  "sweep_close_back",
  "bars_since_sweep_norm",
  "asia_high_distance_over_atr",
  "asia_low_distance_over_atr",
  "structure_direction_relative",
] as const satisfies readonly SmcFeatureName[];

export type SmcOperativeFeatureName = (typeof SMC_OPERATIVE_V1)[number];

export const SMC_OPERATIVE_V1_COUNT = SMC_OPERATIVE_V1.length;

/** Column indices into the frozen 41-vector, in mask order. */
export const SMC_OPERATIVE_V1_INDICES: readonly number[] = SMC_OPERATIVE_V1.map((name) =>
  SMC_FEATURE_NAMES.indexOf(name),
);

/** Project a full 41-length raw vector down to the operative mask order. */
export function projectOperativeV1(fullVector: readonly number[]): number[] {
  return SMC_OPERATIVE_V1_INDICES.map((i) => {
    const v = fullVector[i];
    return Number.isFinite(v) ? v : 0;
  });
}

/** Project from a named map (order still driven by the mask). */
export function projectOperativeV1Named(named: Record<string, number>): number[] {
  return SMC_OPERATIVE_V1.map((k) => (Number.isFinite(named[k]) ? named[k] : 0));
}

/** Named view of the operative subset. */
export function operativeV1NamedView(fullVector: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  projectOperativeV1(fullVector).forEach((v, i) => {
    out[SMC_OPERATIVE_V1[i]] = v;
  });
  return out;
}
