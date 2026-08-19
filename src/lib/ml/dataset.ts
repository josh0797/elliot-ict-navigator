/**
 * Dataset / feature engineering for the trading model — pure, client-safe.
 *
 * Extracted from `training.functions.ts`: TanStack's server-fn split transform
 * deletes runtime siblings of `createServerFn`, so shared helpers must live in
 * their own module.
 */
import { z } from "zod";

/* ===========================================================
 * Feature engineering (shared with the live scorer)
 * =========================================================== */

const PATTERN_KEYS = [
  "impulse",
  "triangle",
  "zigzag",
  "corrective",
  "ending_diagonal",
  "leading_diagonal",
  "double_zigzag",
  "wxy",
  "flat",
] as const;

const DEGREE_KEYS = [
  "primary",
  "intermediate",
  "minor",
  "minute",
  "subminuette",
  "cycle",
  "supercycle",
] as const;

const TF_KEYS = ["m15", "m30", "h1", "h4", "h8", "d1", "d2", "d3", "w1"] as const;

const INSTRUMENT_KEYS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",
  "XAU/USD",
] as const;

const WAVE_BUCKETS = ["impulsive_135", "corrective_24", "abc", "wxy", "subwave"] as const;

export type RawSetupRow = {
  instrument?: string;
  timeframe?: string;
  direction?: string;
  pattern?: string;
  wave_degree?: string;
  wave_current?: string;
  rr_ratio?: string | number;
  sl_pips?: string | number;
  fib_618?: string | number;
  fib_382?: string | number;
  fib_786?: string | number;
  has_alternative?: string | boolean;
  result?: string;
};

export type FeatureVector = number[];

function normalizeInstrument(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toUpperCase().replace(/\s+/g, "");
  if (INSTRUMENT_KEYS.includes(t as (typeof INSTRUMENT_KEYS)[number])) return t;
  // Handle EURUSD-style
  if (/^[A-Z]{6}$/.test(t)) {
    const cand = `${t.slice(0, 3)}/${t.slice(3)}`;
    if (INSTRUMENT_KEYS.includes(cand as (typeof INSTRUMENT_KEYS)[number])) return cand;
  }
  // Long names
  if (/EURO/.test(t) && /DOLLAR/.test(t)) return "EUR/USD";
  if (/POUND/.test(t)) return "GBP/USD";
  if (/YEN/.test(t)) return "USD/JPY";
  if (/SWISS/.test(t) || /CHF/.test(t)) return "USD/CHF";
  if (/AUSTRAL/.test(t)) return "AUD/USD";
  if (/CANAD/.test(t)) return "USD/CAD";
  if (/ZEALAND/.test(t)) return "NZD/USD";
  if (/GOLD/.test(t) || /XAU/.test(t)) return "XAU/USD";
  return null;
}

function normalizeTimeframe(s: string | undefined): (typeof TF_KEYS)[number] | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  const map: Record<string, (typeof TF_KEYS)[number]> = {
    "15min": "m15",
    "15m": "m15",
    "30min": "m30",
    "30m": "m30",
    "1h": "h1",
    "1hr": "h1",
    "4h": "h4",
    "4hr": "h4",
    "8h": "h8",
    "1d": "d1",
    "2d": "d2",
    "3d": "d3",
    "1w": "w1",
  };
  return map[t] ?? null;
}

function normalizePattern(s: string | undefined): (typeof PATTERN_KEYS)[number] | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (/wxy/.test(t)) return "wxy";
  if (/ending diagonal/.test(t)) return "ending_diagonal";
  if (/leading diagonal/.test(t)) return "leading_diagonal";
  if (/double.*zigzag/.test(t)) return "double_zigzag";
  if (/zigzag/.test(t)) return "zigzag";
  if (/triangle/.test(t)) return "triangle";
  if (/impulse/.test(t)) return "impulse";
  if (/flat/.test(t)) return "flat";
  if (/correct/.test(t)) return "corrective";
  return null;
}

function normalizeDegree(s: string | undefined): (typeof DEGREE_KEYS)[number] | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  return (DEGREE_KEYS as readonly string[]).includes(t)
    ? (t as (typeof DEGREE_KEYS)[number])
    : null;
}

function bucketWave(s: string | undefined): (typeof WAVE_BUCKETS)[number] | null {
  if (!s) return null;
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[()[\]]/g, "");
  if (/^[abc]$/.test(t)) return "abc";
  if (/^[xyz]$/.test(t) || /^w[xyz]?$/.test(t)) return "wxy";
  if (/^(1|3|5|i|iii|v)$/.test(t)) return "impulsive_135";
  if (/^(2|4|ii|iv)$/.test(t)) return "corrective_24";
  return "subwave";
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function oneHot<T extends string>(value: T | null, keys: readonly T[]): number[] {
  return keys.map((k) => (k === value ? 1 : 0));
}

export type FeatureSpec = {
  featureNames: string[];
  numericMeans: number[];
  numericStds: number[];
  // ordered keys used during one-hot encoding
  instrumentKeys: readonly string[];
  timeframeKeys: readonly string[];
  patternKeys: readonly string[];
  degreeKeys: readonly string[];
  waveBuckets: readonly string[];
  numericFeatureCount: number;
};

const NUMERIC_FEATURES = [
  "rr_ratio",
  "sl_pips",
  "fib_618_present",
  "fib_382_present",
  "fib_786_present",
  "has_alternative",
];

export function rawToFeatureRaw(row: RawSetupRow): number[] | null {
  const inst = normalizeInstrument(row.instrument);
  const tf = normalizeTimeframe(row.timeframe);
  const pat = normalizePattern(row.pattern);
  const deg = normalizeDegree(row.wave_degree);
  const wave = bucketWave(row.wave_current);
  const dir = (row.direction ?? "").toString().trim().toLowerCase();
  if (dir !== "buy" && dir !== "sell" && dir !== "long" && dir !== "short") return null;
  const dirNum = dir === "buy" || dir === "long" ? 1 : 0;

  const rr = toNumber(row.rr_ratio) ?? 0;
  const sl = toNumber(row.sl_pips) ?? 0;
  const f618 = toNumber(row.fib_618) !== null ? 1 : 0;
  const f382 = toNumber(row.fib_382) !== null ? 1 : 0;
  const f786 = toNumber(row.fib_786) !== null ? 1 : 0;
  const altRaw = (row.has_alternative ?? "").toString().toLowerCase();
  const alt = altRaw === "true" || altRaw === "1" || altRaw === "yes" ? 1 : 0;

  return [
    ...oneHot(inst, INSTRUMENT_KEYS),
    ...oneHot(tf, TF_KEYS),
    ...oneHot(pat, PATTERN_KEYS),
    ...oneHot(deg, DEGREE_KEYS),
    ...oneHot(wave, WAVE_BUCKETS),
    dirNum,
    rr,
    sl,
    f618,
    f382,
    f786,
    alt,
  ];
}

export function buildFeatureSpec(): FeatureSpec {
  const featureNames: string[] = [];
  INSTRUMENT_KEYS.forEach((k) => featureNames.push(`instrument=${k}`));
  TF_KEYS.forEach((k) => featureNames.push(`tf=${k}`));
  PATTERN_KEYS.forEach((k) => featureNames.push(`pattern=${k}`));
  DEGREE_KEYS.forEach((k) => featureNames.push(`degree=${k}`));
  WAVE_BUCKETS.forEach((k) => featureNames.push(`wave=${k}`));
  featureNames.push("direction_long");
  featureNames.push(
    "rr_ratio",
    "sl_pips",
    "fib_618_present",
    "fib_382_present",
    "fib_786_present",
    "has_alternative",
  );
  return {
    featureNames,
    numericMeans: [],
    numericStds: [],
    instrumentKeys: INSTRUMENT_KEYS,
    timeframeKeys: TF_KEYS,
    patternKeys: PATTERN_KEYS,
    degreeKeys: DEGREE_KEYS,
    waveBuckets: WAVE_BUCKETS,
    numericFeatureCount: NUMERIC_FEATURES.length + 1, // +1 for direction
  };
}

/** z-score normalize numeric portion (last `numericFeatureCount` columns). */
function fitNumericStats(X: number[][], numericCount: number): { means: number[]; stds: number[] } {
  const n = X[0].length;
  const start = n - numericCount;
  const means = new Array(numericCount).fill(0);
  const stds = new Array(numericCount).fill(1);
  for (const row of X) for (let j = 0; j < numericCount; j++) means[j] += row[start + j];
  for (let j = 0; j < numericCount; j++) means[j] /= X.length;
  for (const row of X)
    for (let j = 0; j < numericCount; j++) {
      const d = row[start + j] - means[j];
      stds[j] += d * d;
    }
  for (let j = 0; j < numericCount; j++) {
    stds[j] = Math.sqrt(stds[j] / Math.max(1, X.length - 1));
    if (!Number.isFinite(stds[j]) || stds[j] < 1e-8) stds[j] = 1;
  }
  return { means, stds };
}

function applyNumericStats(X: number[][], means: number[], stds: number[]): void {
  const n = X[0].length;
  const numericCount = means.length;
  const start = n - numericCount;
  for (const row of X)
    for (let j = 0; j < numericCount; j++) row[start + j] = (row[start + j] - means[j]) / stds[j];
}
export { fitNumericStats, applyNumericStats };

/** Input schema for CSV-driven training endpoints. */
export const CsvInput = z.object({
  csv: z
    .string()
    .min(20)
    .max(20 * 1024 * 1024),
});
