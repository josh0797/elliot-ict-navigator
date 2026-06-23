import { describe, expect, it } from "vitest";
import { detectPivots, isLastProvisional } from "../structure/pivots";
import type { CandleV2 } from "../schemas/analysis";

/** Build a sine-like price series with deterministic swings. */
function buildSeries(): CandleV2[] {
  const out: CandleV2[] = [];
  const pts: number[] = [];
  for (let i = 0; i < 80; i++) {
    pts.push(100 + 10 * Math.sin(i / 4));
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    out.push({ index: i, time: i, open: p, high: p + 1, low: p - 1, close: p });
  }
  return out;
}

it("detectPivots returns alternating HIGH/LOW pivots on synthetic sine", () => {
  const cs = buildSeries();
  const pivots = detectPivots(cs, { leftBars: 2, rightBars: 2, minAtrDistance: 0.1 });
  expect(pivots.length >= 4).toBeTruthy();
  for (let i = 1; i < pivots.length; i++) {
    expect(pivots[i].type).not.toBe(pivots[i - 1].type);
  }
});

it("detectPivots last pivot may be provisional on truncated series", () => {
  const cs = buildSeries().slice(0, 65); // cut mid-swing
  const pivots = detectPivots(cs, { leftBars: 2, rightBars: 3, minAtrDistance: 0.1 });
  // Not strictly required, but the helper must accept the call without throwing.
  void isLastProvisional(pivots);
  expect(pivots.length > 0).toBeTruthy();
});

it("detectPivots assigns MAJOR strength to large swings", () => {
  const cs = buildSeries();
  const pivots = detectPivots(cs, { leftBars: 2, rightBars: 2, minAtrDistance: 0.1, majorAtrThreshold: 1.5 });
  expect(pivots.some((p) => p.strength === "MAJOR")).toBeTruthy();
});