import { test } from "vitest";
import assert from "node:assert/strict";
import type { PivotV2 } from "../schemas/analysis";
import { analyzeElliott, detectCorrective } from "../elliott/engine";
import { checkImpulseRules } from "../elliott/rules";

function pv(index: number, price: number, type: "HIGH" | "LOW"): PivotV2 {
  return {
    id: `${index}-${type}`,
    index,
    time: index,
    price,
    type,
    strength: "MAJOR",
    atrDistance: 2,
    confirmed: true,
  };
}

test("rules: R1 rejects wave 2 below P0 (long)", () => {
  const r = checkImpulseRules({ direction: "long", pattern: "IMPULSE", p0: 100, p1: 110, p2: 99 });
  assert.equal(r.ok, false);
  assert.ok(r.invalidations.some((s) => s.startsWith("R1")));
});

test("rules: R3 rejects wave 4 overlapping wave 1 (impulse only)", () => {
  const long = checkImpulseRules({ direction: "long", pattern: "IMPULSE", p0: 100, p1: 110, p2: 105, p3: 130, p4: 109 });
  assert.ok(long.invalidations.some((s) => s.startsWith("R3")));
  const diag = checkImpulseRules({ direction: "long", pattern: "ENDING_DIAGONAL", p0: 100, p1: 110, p2: 105, p3: 130, p4: 109 });
  assert.ok(!diag.invalidations.some((s) => s.startsWith("R3")));
});

test("rules: R2 rejects W3 shortest among 1/3/5 (no R1/R3 collision)", () => {
  // Long impulse: p2>p0 (no R1), p4>p1 (no R3 overlap), w3<w1 & w3<w5 (R2 fires).
  // w1=20, w3=15, w5=39 → w3 is the shortest.
  const r = checkImpulseRules({
    direction: "long",
    pattern: "IMPULSE",
    p0: 100, p1: 120, p2: 110, p3: 125, p4: 121, p5: 160,
  });
  assert.ok(r.invalidations.some((s) => s.startsWith("R2")), `expected R2, got: ${r.invalidations.join(" | ")}`);
  assert.ok(!r.invalidations.some((s) => s.startsWith("R1")));
  assert.ok(!r.invalidations.some((s) => s.startsWith("R3")));
});

test("analyzeElliott: valid bullish impulse produces VALID/COMPLETED primary", () => {
  const pivots = [
    pv(0, 100, "LOW"),
    pv(5, 120, "HIGH"),
    pv(10, 110, "LOW"),
    pv(20, 160, "HIGH"),
    pv(25, 140, "LOW"),
    pv(35, 180, "HIGH"),
  ];
  const a = analyzeElliott(pivots);
  assert.ok(a.primary, "primary count must exist");
  assert.equal(a.primary!.direction, "long");
  assert.equal(a.primary!.state === "COMPLETED" || a.primary!.state === "VALID", true);
  assert.ok(a.primary!.score > 0.4);
});

test("analyzeElliott: bearish impulse symmetry", () => {
  const pivots = [
    pv(0, 200, "HIGH"),
    pv(5, 180, "LOW"),
    pv(10, 190, "HIGH"),
    pv(20, 140, "LOW"),
    pv(25, 160, "HIGH"),
    pv(35, 120, "LOW"),
  ];
  const a = analyzeElliott(pivots);
  assert.ok(a.primary);
  assert.equal(a.primary!.direction, "short");
});

test("detectCorrective: bullish impulse → bearish A-B-C", () => {
  const end5 = pv(35, 180, "HIGH");
  const after = [pv(40, 165, "LOW"), pv(45, 173, "HIGH"), pv(50, 158, "LOW")];
  const c = detectCorrective(end5, after, "long");
  assert.ok(c);
  assert.equal(c!.direction, "short");
  assert.equal(c!.labeled.length, 4); // 5 + A + B + C
  assert.equal(c!.currentWave, "C");
});

test("detectCorrective rejects when B exceeds wave-5 origin", () => {
  const end5 = pv(35, 180, "HIGH");
  const after = [pv(40, 165, "LOW"), pv(45, 185, "HIGH")]; // B > end5 → invalid
  const c = detectCorrective(end5, after, "long");
  assert.equal(c, null);
});