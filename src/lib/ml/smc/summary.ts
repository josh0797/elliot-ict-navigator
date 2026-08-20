/**
 * Pure research summaries over SMC dataset rows. No UI, no training.
 */
import { SMC_OPERATIVE_V1 } from "./masks";
import type { SmcDatasetRow } from "./dataset";

export interface FeatureStats {
  name: string;
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
}

function stats(name: string, values: number[]): FeatureStats {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return { name, n: 0, mean: 0, std: 0, min: 0, max: 0, median: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const sorted = [...v].sort((a, b) => a - b);
  const median =
    n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { name, n, mean, std, min: sorted[0], max: sorted[n - 1], median };
}

/** Distribution of the operative 22 features over a row set. */
export function summarizeOperativeFeatures(rows: readonly SmcDatasetRow[]): FeatureStats[] {
  const valid = rows.filter((r) => r.valid && r.features);
  return SMC_OPERATIVE_V1.map((name, i) =>
    stats(
      name,
      valid.map((r) => r.features!.operativeVector[i]),
    ),
  );
}

export interface GroupComparison {
  groupA: string;
  groupB: string;
  nA: number;
  nB: number;
  features: Array<{ name: string; meanA: number; meanB: number; delta: number; stdDelta: number }>;
}

function compare(
  a: readonly SmcDatasetRow[],
  b: readonly SmcDatasetRow[],
  labelA: string,
  labelB: string,
): GroupComparison {
  const sa = summarizeOperativeFeatures(a);
  const sb = summarizeOperativeFeatures(b);
  return {
    groupA: labelA,
    groupB: labelB,
    nA: a.filter((r) => r.valid).length,
    nB: b.filter((r) => r.valid).length,
    features: sa.map((s, i) => {
      const pooled = Math.sqrt((s.std ** 2 + sb[i].std ** 2) / 2) || 1;
      return {
        name: s.name,
        meanA: s.mean,
        meanB: sb[i].mean,
        delta: s.mean - sb[i].mean,
        stdDelta: (s.mean - sb[i].mean) / pooled,
      };
    }),
  };
}

/** SONIC entries vs matched no-entry controls. */
export function comparePositiveVsNegative(rows: readonly SmcDatasetRow[]): GroupComparison {
  return compare(
    rows.filter((r) => r.is_sonic_entry === 1),
    rows.filter((r) => r.is_sonic_entry === 0),
    "sonic_entry",
    "no_entry_control",
  );
}

/** Among SONIC entries: displacement achieved vs not. */
export function summarizeByDisplacementOutcome(
  rows: readonly SmcDatasetRow[],
  horizon: 5 | 15 = 5,
): GroupComparison {
  const positives = rows.filter((r) => r.is_sonic_entry === 1 && r.outcomes);
  const key = horizon === 5 ? "positive_displacement_5m" : "positive_displacement_15m";
  return compare(
    positives.filter((r) => r.outcomes![key]),
    positives.filter((r) => !r.outcomes![key]),
    `displaced_${horizon}m`,
    `not_displaced_${horizon}m`,
  );
}
