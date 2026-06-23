import { describe, expect, it } from "vitest";
import { pickTargets } from "../targets";
import type { ElliottCountV2 } from "../../elliott/types";
import type { PivotV2 } from "../../schemas/analysis";

function pv(label: string, price: number): { label: string; pivot: PivotV2 } {
  return {
    label,
    pivot: {
      id: label, index: 0, time: 0, price,
      type: "HIGH", strength: "MAJOR", atrDistance: 1, confirmed: true,
    },
  };
}

function longCount(currentWave: "2" | "4" | "B", labels: Array<[string, number]>): ElliottCountV2 {
  return {
    direction: "long",
    pattern: "IMPULSE",
    state: "DEVELOPING",
    labeled: labels.map(([l, p]) => pv(l, p)) as ElliottCountV2["labeled"],
    currentWave,
    score: 0.7,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null,
    invalidations: [],
    notes: [],
  };
}

const allocations = { TP1: 50, TP2: 30, TP3: 20 };

describe("targets — fib projections (correct anchor)", () => {
  it("W3 projects 1.618 × |P1-P0| from P2 (not from P1)", () => {
    // P0=100, P1=110, P2=104 → leg=10, projected from 104 → 1.618 ⇒ 120.18
    const primary = longCount("2", [["0", 100], ["1", 110], ["2", 104]]);
    const targets = pickTargets({
      direction: "long", entry: 104, risk: 4, minRR: 1,
      liquidity: [], primary, allocations,
    });
    const tp2 = targets[1];
    expect(tp2.reason).toMatch(/Fib 1\.618 W3/);
    expect(tp2.price).toBeCloseTo(104 + 1.618 * 10, 5);
    // Regression guard: old broken formula would have produced 126.18
    expect(tp2.price).not.toBeCloseTo(126.18, 2);
  });

  it("W5 projects 1.618 × |P3-P2| from P4", () => {
    // P2=104, P3=120, P4=112 → leg=16, projected from 112 ⇒ 137.888
    const primary = longCount("4", [["0", 100], ["1", 110], ["2", 104], ["3", 120], ["4", 112]]);
    const targets = pickTargets({
      direction: "long", entry: 112, risk: 4, minRR: 1,
      liquidity: [], primary, allocations,
    });
    const tp2 = targets[1];
    expect(tp2.reason).toMatch(/Fib 1\.618 W5/);
    expect(tp2.price).toBeCloseTo(112 + 1.618 * 16, 5);
  });

  it("WC projects 1.618 × |A-P5| from B", () => {
    // P5=120, A=108, B=116 → leg=12, projected from 116 (short direction) ⇒ 116 - 1.618*12
    const primary = longCount("B" as "B", [["5", 120], ["A", 108], ["B", 116]]);
    primary.direction = "short";
    const targets = pickTargets({
      direction: "short", entry: 116, risk: 4, minRR: 1,
      liquidity: [], primary, allocations,
    });
    const tp2 = targets[1];
    expect(tp2.reason).toMatch(/Fib 1\.618 WC/);
    expect(tp2.price).toBeCloseTo(116 - 1.618 * 12, 5);
  });
});
