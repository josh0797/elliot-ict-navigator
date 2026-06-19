import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseCsv } from "@/lib/csv";
import { trainLogReg, evaluate, type LogRegModel, type Metrics } from "@/lib/ml/logreg";

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

const DEGREE_KEYS = ["primary", "intermediate", "minor", "minute", "subminuette", "cycle", "supercycle"] as const;

const TF_KEYS = ["m15", "m30", "h1", "h4", "h8", "d1", "d2", "d3", "w1"] as const;

const INSTRUMENT_KEYS = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD", "XAU/USD"] as const;

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
  return (DEGREE_KEYS as readonly string[]).includes(t) ? (t as (typeof DEGREE_KEYS)[number]) : null;
}

function bucketWave(s: string | undefined): (typeof WAVE_BUCKETS)[number] | null {
  if (!s) return null;
  const t = s.trim().toLowerCase().replace(/[()\[\]]/g, "");
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

const NUMERIC_FEATURES = ["rr_ratio", "sl_pips", "fib_618_present", "fib_382_present", "fib_786_present", "has_alternative"];

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
  featureNames.push("rr_ratio", "sl_pips", "fib_618_present", "fib_382_present", "fib_786_present", "has_alternative");
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

/* ===========================================================
 * Server functions (admin-gated)
 * =========================================================== */

async function assertAdmin(context: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

const csvInput = z.object({ csv: z.string().min(20).max(20 * 1024 * 1024) });

export const previewDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => csvInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const rows = parseCsv(data.csv) as unknown as RawSetupRow[];
    let wins = 0;
    let losses = 0;
    let usable = 0;
    let skipped = 0;
    for (const r of rows) {
      const res = (r.result ?? "").toLowerCase();
      if (res === "win") wins++;
      else if (res === "loss") losses++;
      else {
        skipped++;
        continue;
      }
      if (rawToFeatureRaw(r)) usable++;
    }
    return { total: rows.length, wins, losses, usable, skipped };
  });

export const trainModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => csvInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const rows = parseCsv(data.csv) as unknown as RawSetupRow[];

    // Build dataset
    const X: number[][] = [];
    const y: number[] = [];
    for (const r of rows) {
      const label = (r.result ?? "").toLowerCase();
      if (label !== "win" && label !== "loss") continue;
      const feat = rawToFeatureRaw(r);
      if (!feat) continue;
      X.push(feat);
      y.push(label === "win" ? 1 : 0);
    }
    if (X.length < 50) throw new Error(`Not enough labeled rows (got ${X.length}, need 50+)`);

    // Shuffle (seeded by index hash for reproducibility)
    const idx = X.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = (i * 9301 + 49297) % (i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const Xs = idx.map((i) => X[i]);
    const ys = idx.map((i) => y[i]);

    const split = Math.floor(Xs.length * 0.8);
    const Xtrain = Xs.slice(0, split);
    const ytrain = ys.slice(0, split);
    const Xval = Xs.slice(split);
    const yval = ys.slice(split);

    const spec = buildFeatureSpec();
    const { means, stds } = fitNumericStats(Xtrain, spec.numericFeatureCount);
    spec.numericMeans = means;
    spec.numericStds = stds;
    applyNumericStats(Xtrain, means, stds);
    applyNumericStats(Xval, means, stds);

    const model = trainLogReg(Xtrain, ytrain, { learningRate: 0.1, epochs: 600, l2: 0.01 });
    const metrics = evaluate(model, Xval, yval);
    metrics.trainSize = Xtrain.length;

    // Persist via admin client (table is admin-write only)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: maxVerRow } = await supabaseAdmin
      .from("model_versions")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((maxVerRow?.version as number | undefined) ?? 0) + 1;

    // Encode weights
    const weightsArr = new Float64Array([model.bias, ...model.weights]);
    const weights_b64 = Buffer.from(weightsArr.buffer).toString("base64");

    // Deactivate existing
    await supabaseAdmin.from("model_versions").update({ is_active: false }).eq("is_active", true);

    const { error: insErr } = await supabaseAdmin.from("model_versions").insert({
      version: nextVersion,
      trained_on: Xtrain.length + Xval.length,
      accuracy: metrics.accuracy,
      weights_b64,
      model_topology: spec as unknown as never,
      feature_names: spec.featureNames,
      metrics: metrics as unknown as never,
      is_active: true,
    });
    if (insErr) throw new Error(insErr.message);

    // Feature importance: |weight| (already on z-scored numerics + 0/1 categoricals)
    const importances = spec.featureNames
      .map((name, i) => ({ name, weight: model.weights[i] }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 15);

    return { version: nextVersion, metrics, importances };
  });

export const listModelVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("model_versions")
      .select("id,version,trained_on,accuracy,metrics,feature_names,is_active,created_at")
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setActiveModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("model_versions").update({ is_active: false }).eq("is_active", true);
    const { error } = await supabaseAdmin
      .from("model_versions")
      .update({ is_active: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const checkAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });