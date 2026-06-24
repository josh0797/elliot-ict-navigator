import { describe, expect, it } from "vitest";
import { computeScore } from "../scoring";
import { DEFAULT_CONFIG } from "../config";
import type { ElliottAnalysis, ElliottCountV2 } from "../../elliott/types";
import type { IctContext, LiquiditySweep, OrderBlock } from "../../ict/types";
import type { SelectedPOI } from "../poi-selector";

function bull(): ElliottCountV2 {
  return {
    direction: "long", pattern: "IMPULSE", state: "DEVELOPING",
    labeled: [], currentWave: "2", score: 0.7,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null, invalidations: [], notes: [],
  };
}
const elliott: ElliottAnalysis = { primary: bull(), alternatives: [] };

function ob(id: string, state: OrderBlock["state"] = "FRESH"): OrderBlock {
  return {
    id, type: "BULLISH", top: 101, bottom: 100, originIndex: 1, originTime: 0,
    state, touchCount: 0, mitigationPercent: 0, displacementConfirmed: true,
    bosConfirmed: true, fvgAssociated: false, volumeConfirmation: false,
    bosRef: null, fvgRef: null, quality: 70, rangePolicy: "FULL_CANDLE",
  };
}
function sweep(opts: Partial<LiquiditySweep> = {}): LiquiditySweep {
  return {
    id: "sw", side: "SSL", type: "sell_side", price: 99, time: 0, index: 90,
    targetLiquidityId: "x", wickBeyond: true, closeBack: true,
    displacementAfter: true, mitigated: false, quality: 80, ...opts,
  };
}
function ict(overrides: Partial<IctContext> = {}): IctContext {
  return {
    bias: "BULLISH", fvgs: [], orderBlocks: [ob("ob1")], liquidity: [],
    sweeps: [], structure: [], killzone: null, pdArray: null, score: 0.5, ...overrides,
  };
}
const poi: SelectedPOI = {
  type: "OB", direction: "BULLISH", top: 101, bottom: 100,
  proximal: 101, distal: 100, midpoint: 100.5, quality: 70, sourceIds: ["ob1"],
};

describe("computeScore", () => {
  it("clamps to 0..100 and exposes rawScore/maxAvailableScore", () => {
    const r = computeScore({ direction: "long", elliott, ict: ict(), poi, weights: DEFAULT_CONFIG.weights, recentBars: 15, candleCount: 100 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.maxAvailableScore).toBeGreaterThan(0);
    expect(r.rawScore).toBeGreaterThanOrEqual(0);
  });

  it("does NOT award SWEEP_OPPOSITE_RECENT for an incomplete sweep (no closeBack)", () => {
    const r = computeScore({
      direction: "long", elliott,
      ict: ict({ sweeps: [sweep({ closeBack: false })] }),
      poi, weights: DEFAULT_CONFIG.weights, recentBars: 15, candleCount: 95,
    });
    const a = r.confluences.find((c) => c.code === "SWEEP_OPPOSITE_RECENT")!;
    expect(a.active).toBe(false);
    expect(a.points).toBe(0);
  });

  it("awards SWEEP_OPPOSITE_RECENT when wickBeyond && closeBack are both true", () => {
    const r = computeScore({
      direction: "long", elliott,
      ict: ict({ sweeps: [sweep()] }),
      poi, weights: DEFAULT_CONFIG.weights, recentBars: 15, candleCount: 95,
    });
    expect(r.confluences.find((c) => c.code === "SWEEP_OPPOSITE_RECENT")!.active).toBe(true);
  });

  it("does NOT award KILLZONE_ACTIVE when no killzone is active", () => {
    const r = computeScore({ direction: "long", elliott, ict: ict({ killzone: null }), poi, weights: DEFAULT_CONFIG.weights, recentBars: 15, candleCount: 100 });
    expect(r.confluences.find((c) => c.code === "KILLZONE_ACTIVE")!.active).toBe(false);
  });

  it("does NOT award OB_VALID when source OB has been mitigated", () => {
    const r = computeScore({
      direction: "long", elliott,
      ict: ict({ orderBlocks: [ob("ob1", "MITIGATED")] }),
      poi, weights: DEFAULT_CONFIG.weights, recentBars: 15, candleCount: 100,
    });
    expect(r.confluences.find((c) => c.code === "OB_VALID")!.active).toBe(false);
  });

  it("throws on negative weight", () => {
    expect(() => computeScore({
      direction: "long", elliott, ict: ict(), poi,
      weights: { ...DEFAULT_CONFIG.weights, ELLIOTT_ALIGNED: -1 },
      recentBars: 15, candleCount: 100,
    })).toThrow();
  });
});