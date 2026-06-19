import { test } from "node:test";
import assert from "node:assert/strict";
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

test("detectPivots returns alternating HIGH/LOW pivots on synthetic sine", () => {
  const cs = buildSeries();
  const pivots = detectPivots(cs, { leftBars: 2, rightBars: 2, minAtrDistance: 0.1 });
  assert.ok(pivots.length >= 4, `got ${pivots.length} pivots`);
  for (let i = 1; i < pivots.length; i++) {
    assert.notEqual(pivots[i].type, pivots[i - 1].type, "consecutive pivots must alternate");
  }
});

test("detectPivots last pivot may be provisional on truncated series", () => {
  const cs = buildSeries().slice(0, 65); // cut mid-swing
  const pivots = detectPivots(cs, { leftBars: 2, rightBars: 3, minAtrDistance: 0.1 });
  // Not strictly required, but the helper must accept the call without throwing.
  void isLastProvisional(pivots);
  assert.ok(pivots.length > 0);
});

test("detectPivots assigns MAJOR strength to large swings", () => {
  const cs = buildSeries();
  const pivots = detectPivots(cs, { leftBars: 2, rightBars: 2, minAtrDistance: 0.1, majorAtrThreshold: 1.5 });
  assert.ok(pivots.some((p) => p.strength === "MAJOR"));
});