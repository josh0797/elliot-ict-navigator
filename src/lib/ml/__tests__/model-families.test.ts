/**
 * Phase 0 regression tests — multi-family model catalog.
 * Runs against the live project database (read-only for existing rows).
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = !!URL && !!KEY;
const d = enabled ? describe : describe.skip;

const admin = enabled ? createClient(URL!, KEY!, { auth: { persistSession: false } }) : null;

d("model_versions families", () => {
  it("keeps the existing Elliott model active under ELLIOTT_BASELINE", async () => {
    const { data, error } = await admin!
      .from("model_versions")
      .select("version,family,is_active")
      .eq("family", "ELLIOTT_BASELINE")
      .eq("is_active", true);
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].version).toBe(1);
  });

  it("activating an SMC_M30 model does not deactivate Elliott, and blocks a 2nd active sibling", async () => {
    const rowsToClean: string[] = [];
    try {
      const base = {
        model_topology: {},
        weights_b64: "AAAAAAAAAAA=",
        feature_names: ["dummy"],
        trained_on: 0,
      };
      const { data: smc, error: e1 } = await admin!
        .from("model_versions")
        .insert({ ...base, family: "SMC_M30", version: 9001, is_active: true })
        .select("id")
        .single();
      expect(e1).toBeNull();
      rowsToClean.push(smc!.id);

      // Elliott stays active
      const { data: ell } = await admin!
        .from("model_versions")
        .select("id")
        .eq("family", "ELLIOTT_BASELINE")
        .eq("is_active", true);
      expect(ell!.length).toBe(1);

      // Second active SMC_M30 row must be rejected by the partial unique index
      const { data: dup, error: e2 } = await admin!
        .from("model_versions")
        .insert({ ...base, family: "SMC_M30", version: 9002, is_active: true })
        .select("id");
      if (dup?.length) rowsToClean.push(...dup.map((r) => r.id));
      expect(e2).not.toBeNull();

      // Inactive sibling of the same family is fine
      const { data: ok, error: e3 } = await admin!
        .from("model_versions")
        .insert({ ...base, family: "SMC_M30", version: 9002, is_active: false })
        .select("id")
        .single();
      expect(e3).toBeNull();
      rowsToClean.push(ok!.id);
    } finally {
      if (rowsToClean.length) await admin!.from("model_versions").delete().in("id", rowsToClean);
    }
  });
});
