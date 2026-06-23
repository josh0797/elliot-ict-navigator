import { describe, expect, it } from "vitest";
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

it("rules: R1 rejects wave 2 below P0 (long)", () => {
  const r = checkImpulseRules({ direction: "long", pattern: "IMPULSE", p0: 100, p1: 110, p2: 99 });
  expect(r.ok).toBe(false);
  expect(r.invalidations.some((s) => s.startsWith("R1"))).toBeTruthy();
});

it("rules: R3 rejects wave 4 overlapping wave 1 (impulse only)", () => {
  const long = checkImpulseRules({ direction: "long", pattern: "IMPULSE", p0: 100, p1: 110, p2: 105, p3: 130, p4: 109 });
  expect(long.invalidations.some((s) => s.startsWith("R3"))).toBeTruthy();
  const diag = checkImpulseRules({ direction: "long", pattern: "ENDING_DIAGONAL", p0: 100, p1: 110, p2: 105, p3: 130, p4: 109 });
  expect(!diag.invalidations.some((s) => s.startsWith("R3"))).toBeTruthy();
});

it("rules: R2 rejects W3 shortest among 1/3/5 (no R1/R3 collision)", () => {
  // Long impulse: p2>p0 (no R1), p4>p1 (no R3 overlap), w3<w1 & w3<w5 (R2 fires).
  // w1=20, w3=15, w5=39 → w3 is the shortest.
  const r = checkImpulseRules({
    direction: "long",
    pattern: "IMPULSE",
    p0: 100, p1: 120, p2: 110, p3: 125, p4: 121, p5: 160,
  });
  expect(r.invalidations.some((s) => s.startsWith("R2"))).toBeTruthy();
  expect(!r.invalidations.some((s) => s.startsWith("R1"))).toBeTruthy();
  expect(!r.invalidations.some((s) => s.startsWith("R3"))).toBeTruthy();
});

it("analyzeElliott: valid bullish impulse produces VALID/COMPLETED primary", () => {
  const pivots = [
    pv(0, 100, "LOW"),
    pv(5, 120, "HIGH"),
    pv(10, 110, "LOW"),
    pv(20, 160, "HIGH"),
    pv(25, 140, "LOW"),
    pv(35, 180, "HIGH"),
  ];
  const a = analyzeElliott(pivots);
  expect(a.primary).toBeTruthy();
  expect(a.primary!.direction).toBe("long");
  expect(a.primary!.state === "COMPLETED" || a.primary!.state === "VALID").toBe(true);
  expect(a.primary!.score > 0.4).toBeTruthy();
});

it("analyzeElliott: bearish impulse symmetry", () => {
  const pivots = [
    pv(0, 200, "HIGH"),
    pv(5, 180, "LOW"),
    pv(10, 190, "HIGH"),
    pv(20, 140, "LOW"),
    pv(25, 160, "HIGH"),
    pv(35, 120, "LOW"),
  ];
  const a = analyzeElliott(pivots);
  expect(a.primary).toBeTruthy();
  expect(a.primary!.direction).toBe("short");
});

it("detectCorrective: bullish impulse → bearish A-B-C", () => {
  const end5 = pv(35, 180, "HIGH");
  const after = [pv(40, 165, "LOW"), pv(45, 173, "HIGH"), pv(50, 158, "LOW")];
  const c = detectCorrective(end5, after, "long");
  expect(c).toBeTruthy();
  expect(c!.direction).toBe("short");
  expect(c!.labeled.length).toBe(4); // 5 + A + B + C
  expect(c!.currentWave).toBe("C");
});

it("detectCorrective rejects when B exceeds wave-5 origin", () => {
  const end5 = pv(35, 180, "HIGH");
  const after = [pv(40, 165, "LOW"), pv(45, 185, "HIGH")]; // B > end5 → invalid
  const c = detectCorrective(end5, after, "long");
  expect(c).toBe(null);
});