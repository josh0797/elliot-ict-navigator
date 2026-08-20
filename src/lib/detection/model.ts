import type { LogRegModel } from "@/lib/ml/logreg";
import { predictProba } from "@/lib/ml/logreg";
import type { FeatureSpec, RawSetupRow } from "@/lib/ml/dataset";
import { rawToFeatureRaw } from "@/lib/ml/dataset";

/** Model families stored in `model_versions`. Each has its own active version. */
export type ModelFamily = "ELLIOTT_BASELINE" | "SMC_M30" | "ENSEMBLE";

export const DEFAULT_MODEL_FAMILY: ModelFamily = "ELLIOTT_BASELINE";

type LoadedModel = {
  model: LogRegModel;
  spec: FeatureSpec;
  version: number;
  family: ModelFamily;
};

const cache = new Map<ModelFamily, LoadedModel>();

/** Clear the in-process model cache (used by tests and after training). */
export function clearModelCache(family?: ModelFamily): void {
  if (family) cache.delete(family);
  else cache.clear();
}

export async function loadActiveModel(
  family: ModelFamily = DEFAULT_MODEL_FAMILY,
): Promise<LoadedModel | null> {
  const hit = cache.get(family);
  if (hit) return hit;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("model_versions")
    .select("version,weights_b64,model_topology")
    .eq("family", family)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const spec = data.model_topology as unknown as FeatureSpec;
  const buf = Buffer.from(data.weights_b64, "base64");
  const f64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const arr = Array.from(f64);
  const bias = arr[0];
  const weights = arr.slice(1);
  const loaded: LoadedModel = { model: { weights, bias }, spec, version: data.version, family };
  cache.set(family, loaded);
  return loaded;
}

/** Apply z-score normalization to numeric tail of a raw feature row using spec stats. */
function applySpec(spec: FeatureSpec, raw: number[]): number[] {
  const out = raw.slice();
  const numericCount = spec.numericMeans.length;
  const start = out.length - numericCount;
  for (let j = 0; j < numericCount; j++) {
    const std = spec.numericStds[j] || 1;
    out[start + j] = (out[start + j] - spec.numericMeans[j]) / std;
  }
  return out;
}

/** Probability that the setup will be a win (0..1). Returns null if no model. */
export async function scoreSetupML(
  row: RawSetupRow,
  family: ModelFamily = DEFAULT_MODEL_FAMILY,
): Promise<number | null> {
  const c = await loadActiveModel(family);
  if (!c) return null;
  const raw = rawToFeatureRaw(row);
  if (!raw) return null;
  const x = applySpec(c.spec, raw);
  return predictProba(c.model, x);
}
