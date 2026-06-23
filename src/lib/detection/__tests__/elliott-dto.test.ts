import { test } from "vitest";
import assert from "node:assert/strict";
import { toElliottResult } from "../elliott/dto";
import type { ElliottAnalysis, ElliottCountV2, LabeledPivot, WaveLabel } from "../elliott/types";
import type { PivotV2 } from "../schemas/analysis";

function pv(index: number, price: number, type: "HIGH" | "LOW", confirmed = true): PivotV2 {
  return { id: `${index}-${type}`, index, time: 1_700_000_000 + index * 3600, price, type, strength: "MAJOR", atrDistance: 2, confirmed };
}
function labeled(prices: number[]): LabeledPivot[] {
  const labels: WaveLabel[] = ["0", "1", "2", "3", "4", "5"];
  return prices.map((p, i) => ({ pivot: pv(i * 5, p, i % 2 === 0 ? "LOW" : "HIGH"), label: labels[i] }));
}
function count(prices: number[], opts: Partial<ElliottCountV2> = {}): ElliottCountV2 {
  return {
    direction: prices[1] > prices[0] ? "long" : "short",
    pattern: "IMPULSE",
    state: "COMPLETED",
    labeled: labeled(prices),
    currentWave: "5",
    score: 0.8,
    fibScores: { wave2Retracement: 1, wave3Extension: 1, wave4Retracement: 1, wave5Projection: 1 },
    alternation: 1,
    invalidations: [],
    notes: [],
    ...opts,
  };
}

test("Elliott DTO: clean impulse → COMPLETED with high confidence", () => {
  const analysis: ElliottAnalysis = { primary: count([100, 110, 105, 130, 120, 140]), alternatives: [] };
  const dto = toElliottResult(analysis, "BULLISH");
  assert.equal(dto.status, "COMPLETED");
  assert.equal(dto.bias, "BULLISH");
  assert.equal(dto.currentWave, "5");
  assert.equal(dto.completion, 1);
  assert.ok(dto.confidence > 60, `confidence ${dto.confidence} should exceed 60`);
  assert.equal(dto.rules.find((r) => r.code === "W2_ORIGIN")?.status, "PASS");
});

test("Elliott DTO: invalidated → confidence 0, W2_ORIGIN FAIL", () => {
  const c = count([100, 110, 95, 130, 120, 140], { state: "INVALIDATED", invalidations: ["R1: wave 2 retraced 100% of wave 1 (past P0)"] });
  const dto = toElliottResult({ primary: c, alternatives: [] }, "BULLISH");
  assert.equal(dto.status, "INVALIDATED");
  assert.equal(dto.confidence, 0);
  assert.equal(dto.rules.find((r) => r.code === "W2_ORIGIN")?.status, "FAIL");
});

test("Elliott DTO: developing count → W3_NOT_SHORTEST PENDING", () => {
  const c = count([100, 110, 105, 130], {
    state: "DEVELOPING",
    labeled: labeled([100, 110, 105, 130]),
    currentWave: "3",
    fibScores: { wave2Retracement: 0.8, wave3Extension: 0.9, wave4Retracement: null, wave5Projection: null },
    alternation: null,
  });
  const dto = toElliottResult({ primary: c, alternatives: [] }, "BULLISH");
  assert.equal(dto.status, "DEVELOPING");
  assert.equal(dto.currentWave, "3");
  assert.equal(dto.rules.find((r) => r.code === "W3_NOT_SHORTEST")?.status, "PENDING");
});

test("Elliott DTO: invalidationLevel uses P1 when currentWave=4", () => {
  const c = count([100, 110, 105, 130, 115], {
    state: "VALID",
    labeled: labeled([100, 110, 105, 130, 115]),
    currentWave: "4",
    fibScores: { wave2Retracement: 0.8, wave3Extension: 0.9, wave4Retracement: 0.7, wave5Projection: null },
  });
  const dto = toElliottResult({ primary: c, alternatives: [] }, "BULLISH");
  assert.equal(dto.invalidationLevel, 110);
});
