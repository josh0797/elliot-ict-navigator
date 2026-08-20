import { describe, expect, it } from "vitest";
import { SMC_FEATURE_NAMES } from "../features";
import {
  SMC_OPERATIVE_V1,
  SMC_OPERATIVE_V1_COUNT,
  SMC_OPERATIVE_V1_INDICES,
  operativeV1NamedView,
  projectOperativeV1,
  projectOperativeV1Named,
} from "../masks";

describe("SMC_OPERATIVE_V1 mask", () => {
  it("has exactly 22 unique names that all exist in the frozen raw schema", () => {
    expect(SMC_OPERATIVE_V1_COUNT).toBe(22);
    expect(new Set(SMC_OPERATIVE_V1).size).toBe(22);
    for (const name of SMC_OPERATIVE_V1) expect(SMC_FEATURE_NAMES).toContain(name);
    expect(SMC_OPERATIVE_V1_INDICES.every((i) => i >= 0)).toBe(true);
  });

  it("excludes sweep_quality_norm (post-entry displacement leakage)", () => {
    expect(SMC_OPERATIVE_V1 as readonly string[]).not.toContain("sweep_quality_norm");
    expect(SMC_FEATURE_NAMES).toContain("sweep_quality_norm");
  });

  it("keeps a stable order and deterministic projection", () => {
    const full = SMC_FEATURE_NAMES.map((_, i) => i / 100);
    const a = projectOperativeV1(full);
    const b = projectOperativeV1(full);
    expect(a).toEqual(b);
    expect(a.length).toBe(22);
    expect(a).toEqual(SMC_OPERATIVE_V1_INDICES.map((i) => full[i]));
    const named: Record<string, number> = {};
    SMC_FEATURE_NAMES.forEach((n, i) => (named[n] = i / 100));
    expect(projectOperativeV1Named(named)).toEqual(a);
    expect(Object.keys(operativeV1NamedView(full))).toEqual([...SMC_OPERATIVE_V1]);
  });

  it("coerces non-finite values to 0", () => {
    const full = SMC_FEATURE_NAMES.map(() => NaN);
    expect(projectOperativeV1(full).every((v) => v === 0)).toBe(true);
  });
});
