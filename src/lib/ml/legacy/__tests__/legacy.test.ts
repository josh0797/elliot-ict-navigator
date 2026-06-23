import { describe, expect, it } from "vitest";
import {
  extractLegacyFeatures,
  LEGACY_FEATURE_ORDER,
  waveCode,
  normalizeLegacy,
} from "../features";
import { predictLegacy, LEGACY_WEIGHT_MATRICES, LEGACY_SHAPES } from "../mlp";
import { scoreLegacy, LEGACY_SCHEMA, LEGACY_METADATA } from "..";
import { PRETRAINED } from "../pretrained";

function close(actual: number, expected: number, tol = 1e-12) {
  expect(Math.abs(actual - expected) <= tol).toBeTruthy();
}

function baseInput() {
  return {
    confirmationLevel: 100,
    invalidationLevel: 90,
    fibTarget1: 120,
    rrRatio: 2,
    hasAlternative: false,
    currentPriceApprox: 105,
    waveLabel: "3",
  };
}

const MN = PRETRAINED.minNorm as unknown as number[];
const MX = PRETRAINED.maxNorm as unknown as number[];

it("1. exact formula per feature", () => {
  const f = extractLegacyFeatures(baseInput()).raw;
  close(f[0], 0.4);
  close(f[1], 1.0);
  expect(f[2]).toBe(0.5);
  close(f[3], 0.58);
  close(f[4], 5 / 10 / 3);
  expect(f[5]).toBe(0.9);
});

it("2. feature order is canonical", () => {
  expect(LEGACY_FEATURE_ORDER).toEqual([
    "fvgSizeProxy",
    "atrNormProxy",
    "isKillzone",
    "scoreProxy",
    "distObProxy",
    "waveCode",
  ]);
});

it("3. vector length is 6", () => {
  const f = extractLegacyFeatures(baseInput());
  expect(f.raw.length).toBe(6);
  expect(f.normalized.length).toBe(6);
});

it("4. tp fallback is 2R when fibTarget1 missing", () => {
  const f = extractLegacyFeatures({ ...baseInput(), fibTarget1: null }).raw;
  close(f[0], 0.4);
});

it("5. distOB fallback is 0.5 when currentPriceApprox missing", () => {
  const f = extractLegacyFeatures({ ...baseInput(), currentPriceApprox: null }).raw;
  expect(f[4]).toBe(0.5);
});

it("6. isKillzone is constant 0.5", () => {
  for (const inp of [baseInput(), { ...baseInput(), rrRatio: 0 }, { ...baseInput(), waveLabel: null }]) {
    expect(extractLegacyFeatures(inp).raw[2]).toBe(0.5);
  }
});

it("7. waveCode mapping (legacy literal)", () => {
  const cases: Array<[string, number]> = [
    ["1", 0.1], ["(1)", 0.1], ["i", 0.1], ["(i)", 0.1], ["(I)", 0.1],
    ["2", 0.2], ["(2)", 0.2], ["ii", 0.2], ["(ii)", 0.2],
    ["3", 0.9], ["(3)", 0.9], ["iii", 0.9], ["(iii)", 0.9],
    ["4", 0.4], ["(4)", 0.4], ["iv", 0.4], ["(iv)", 0.4],
    ["5", 0.6], ["(5)", 0.6], ["v", 0.6], ["(v)", 0.6],
    ["A", 0.3], ["a", 0.3],
    ["B", 0.1], ["b", 0.1],
    ["C", 0.7], ["c", 0.7],
  ];
  for (const [label, expected] of cases) {
    expect(waveCode(label).value).toBe(expected);
  }
  const r = extractLegacyFeatures({ ...baseInput(), waveLabel: "Z" });
  expect(r.raw[5]).toBe(0.5);
  expect(r.warnings.includes("UNKNOWN_WAVE_LABEL")).toBeTruthy();
});

it("8. min-max normalization matches PRETRAINED", () => {
  const raw = [0.4, 1.0, 0.5, 0.58, 0.5 / 3, 0.9];
  const norm = normalizeLegacy(raw, MN, MX);
  for (let i = 0; i < 6; i++) {
    const expected = MX[i] > MN[i] ? (raw[i] - MN[i]) / (MX[i] - MN[i]) : 0.5;
    close(norm[i], expected);
  }
});

it("9. zero-range index normalizes to 0.5", () => {
  for (const rawVal of [0, 0.5, 1, -3, 99]) {
    const out = normalizeLegacy([0, 0, rawVal, 0, 0, 0], MN, MX);
    expect(out[2]).toBe(0.5);
  }
});

it("10. forward pass matches reference NumPy prediction", () => {
  // Golden value computed from the same PRETRAINED weights using NumPy.
  // See plan §5.10. Any change in weights, formulas, or normalization
  // will break this assertion.
  const r = scoreLegacy(baseInput());
  expect(r.schema).toBe(LEGACY_SCHEMA);
  close(r.probability, 0.6192760259025438, 1e-9);
});

it("11. weight matrix shapes are [6,12],[12],[12,8],[8],[8,1],[1]", () => {
  expect(LEGACY_SHAPES).toEqual([[6, 12], [12], [12, 8], [8], [8, 1], [1]]);
  const { W0, B0, W1, B1, W2, B2 } = LEGACY_WEIGHT_MATRICES;
  expect(W0.length).toBe(6);
  expect(W0[0].length).toBe(12);
  expect(B0.length).toBe(12);
  expect(W1.length).toBe(12);
  expect(W1[0].length).toBe(8);
  expect(B1.length).toBe(8);
  expect(W2.length).toBe(8);
  expect(W2[0].length).toBe(1);
  expect(B2.length).toBe(1);
});

it("metadata advertises frozen schema and warnings", () => {
  expect(LEGACY_METADATA.schema).toBe("legacy-pretrained-html-v1");
  expect(LEGACY_METADATA.status).toBe("TRAINING_SCHEMA_VERIFIED");
  expect(LEGACY_METADATA.warnings.length >= 8).toBeTruthy();
  close(LEGACY_METADATA.accuracyTest, 0.5286, 1e-3);
  // Direct call avoids the unused-import lint and exercises the matVec path
  expect(predictLegacy([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]) >= 0).toBeTruthy();
});