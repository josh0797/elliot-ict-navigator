import { describe, expect, it } from "vitest";
import { classifyTemplate } from "../template";
import type { ElliottAnalysis, ElliottCountV2 } from "../../elliott/types";
import type { IctContext } from "../../ict/types";
import type { TradeSignal } from "../../setup/types";

function emptyIct(): IctContext {
  return { bias: "NEUTRAL", fvgs: [], orderBlocks: [], liquidity: [], sweeps: [], structure: [], killzone: null, pdArray: null, score: 0 };
}
function bull(state: ElliottCountV2["state"] = "DEVELOPING"): ElliottCountV2 {
  return {
    direction: "long", pattern: "IMPULSE", state,
    labeled: [], currentWave: "2", score: 0.6,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null, invalidations: [], notes: [],
  };
}
const baseSignal: TradeSignal = {
  schemaVersion: "canonical-setup-v2", id: "s", setupKey: "s", symbol: "X", timeframe: "1h",
  direction: "long", directionUpper: "LONG", orderType: "BUY_LIMIT", status: "WAITING_RETRACE",
  entry: 1, sl: 0.9, tp1: 1.1, tp2: 1.2, rrToTp1: 1, rrToTp2: 2,
  entryZone: { top: 1, bottom: 0.95 }, entryPolicy: "OB_PROXIMAL", stopReason: "BEYOND_ORDER_BLOCK",
  targets: [], selectedPoi: null, trigger: null, priceAtDetection: 1,
  slBasis: { elliottInvalidation: null, poiExtreme: 0.9, sweepExtreme: null, protectedSwing: null, atrBuffer: 0.01, chosen: "min" },
  tp1Source: { kind: "FALLBACK", fallback: "2R" }, tp2Source: { kind: "FALLBACK", fallback: "3R" },
  poi: { kind: "ORDER_BLOCK", id: "ob", proximal: 1, distal: 0.9, state: "FRESH" },
  score: 0.5, scoreOut100: 50, grade: "WATCH", hardBlockers: [], warnings: [],
  mlScore: null, modelVersion: null,
  breakdown: { elliott: 0.5, ict: 0.5, confluence: 0.5 }, confluences: [], confluencesDetail: [],
  gatesPassed: [], waveLabel: "2", rationale: "", nextAction: "",
  invalidation: { price: 0.9, reason: null }, detectedAt: 0, expiresAt: null,
  finalScore: 0.5, poiKind: "ORDER_BLOCK", poiId: "ob",
};

describe("classifyTemplate", () => {
  it("Elliott INVALIDATED → still classifies via wave context (defense lives in engine)", () => {
    const elliott: ElliottAnalysis = { primary: bull("INVALIDATED"), alternatives: [] };
    const t = classifyTemplate(baseSignal, elliott, emptyIct(), 100);
    // wave === "2" → W3 entry; decision engine is responsible for blocking
    expect(t).toBe("ELLIOTT_WAVE_3_ENTRY");
  });

  it("no signal → NO_VALID_TEMPLATE", () => {
    const elliott: ElliottAnalysis = { primary: null, alternatives: [] };
    expect(classifyTemplate(null, elliott, emptyIct(), 100)).toBe("NO_VALID_TEMPLATE");
  });
});