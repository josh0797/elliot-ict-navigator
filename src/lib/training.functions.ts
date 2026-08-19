/**
 * Training server functions — thin wrappers.
 * Feature engineering lives in `@/lib/ml/dataset`; only RPC declarations and
 * their handlers belong here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseCsv } from "@/lib/csv";
import { trainLogReg, evaluate } from "@/lib/ml/logreg";
import {
  applyNumericStats,
  buildFeatureSpec,
  fitNumericStats,
  rawToFeatureRaw,
  CsvInput,
  type RawSetupRow,
} from "@/lib/ml/dataset";
import { assertAdmin } from "@/lib/training.server";

export type { FeatureSpec, FeatureVector, RawSetupRow } from "@/lib/ml/dataset";
export { rawToFeatureRaw } from "@/lib/ml/dataset";

export const previewDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CsvInput.parse(d))
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
  .inputValidator((d: unknown) => CsvInput.parse(d))
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
