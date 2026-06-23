import { describe, expect, it } from "vitest";
import { decideOperation } from "../engine";
import { computeDirectionBias } from "../direction";
import type { ElliottAnalysis, ElliottCountV2 } from "../../elliott/types";
import type { IctContext, StructureEvent } from "../../ict/types";
import type { TradeSignal } from "../../setup/types";

function bullishCount(invalidations: string[] = []): ElliottCountV2 {
  return {
    direction: "long",
    pattern: "IMPULSE",
    state: invalidations.length > 0 ? "INVALIDATED" : "DEVELOPING",
    labeled: [],
    currentWave: "2",
    score: 0.7,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null,
    invalidations,
    notes: [],
  };
}

function ict(bias: "BULLISH" | "BEARISH" | "NEUTRAL", extra: Partial<IctContext> = {}): IctContext {
  return {
    bias,
    fvgs: [],
    orderBlocks: [],
    liquidity: [],
    sweeps: [],
    structure: [],
    killzone: null,
    pdArray: null,
    score: 0.5,
    ...extra,
  };
}

function bullishSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  const base: TradeSignal = {
    schemaVersion: "canonical-setup-v2",
    id: "sig-1",
    symbol: "EUR/USD",
    timeframe: "1h",
    direction: "long",
    orderType: "BUY_LIMIT",
    status: "WAITING_RETRACE",
    entry: 1.10,
    sl: 1.095,
    tp1: 1.115,
    tp2: 1.125,
    rrToTp1: 3,
    rrToTp2: 5,
    priceAtDetection: 1.102,
    slBasis: { elliottInvalidation: 1.095, poiExtreme: 1.095, sweepExtreme: null, protectedSwing: null, atrBuffer: 0.0005, chosen: "min" },
    tp1Source: { kind: "FALLBACK", fallback: "2R" },
    tp2Source: { kind: "FALLBACK", fallback: "3R" },
    poi: { kind: "ORDER_BLOCK", id: "ob1", proximal: 1.10, distal: 1.095, state: "FRESH" },
    score: 0.75,
    mlScore: null,
    modelVersion: null,
    breakdown: { elliott: 0.7, ict: 0.6, confluence: 0.8 },
    confluences: ["BIAS_ALIGN", "OB_CONFLUENCE"],
    gatesPassed: [],
    waveLabel: "2",
    rationale: "test",
    detectedAt: 0,
    finalScore: 0.75,
    poiKind: "ORDER_BLOCK",
    poiId: "ob1",
  };
  return { ...base, ...overrides };
}

describe("decision/engine", () => {
  it("returns NO_TRADE when no Elliott count exists", () => {
    const r = decideOperation({ primary: null, alternatives: [] }, ict("NEUTRAL"), [], 100);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.reasons).toContain("NO_PRIMARY_COUNT");
  });

  it("returns NO_TRADE when primary is INVALIDATED and no alternatives", () => {
    const r = decideOperation({ primary: bullishCount(["W2_ORIGIN failed"]), alternatives: [] }, ict("NEUTRAL"), [], 100);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.reasons).toContain("ELLIOTT_INVALIDATED");
  });

  it("returns BUY when bullish bias and gated signal align", () => {
    const elliott: ElliottAnalysis = { primary: bullishCount(), alternatives: [] };
    const struct: StructureEvent = {
      id: "s1", type: "CHoCH", direction: "long", price: 1.1, time: 0, index: 95,
      state: "CONFIRMED", brokenPivotId: "p", breakIndex: 95, breakPrice: 1.1, closeBeyondAtr: 1, displacement: true,
    };
    const r = decideOperation(elliott, ict("BULLISH", { structure: [struct] }), [bullishSignal()], 100);
    expect(r.decision).toBe("BUY");
    expect(r.status).toBe("ARMED");
    expect(r.primarySignal?.id).toBe("sig-1");
  });

  it("returns WAIT when bias is bullish but no signal cleared gates", () => {
    const elliott: ElliottAnalysis = { primary: bullishCount(), alternatives: [] };
    const r = decideOperation(elliott, ict("BULLISH"), [], 100);
    expect(r.decision).toBe("WAIT");
    expect(r.status === "WAITING_FOR_SWEEP" || r.status === "WAITING_FOR_STRUCTURE_SHIFT" || r.status === "WATCHING").toBe(true);
  });

  it("flags DIRECTION_CONFLICT when bull and bear votes are close", () => {
    const elliott: ElliottAnalysis = { primary: bullishCount(), alternatives: [] };
    const ctx = ict("BEARISH", {
      pdArray: { high: 2, low: 1, midpoint: 1.5, currentPrice: 1.9, zone: "PREMIUM", position: 0.9 },
    });
    const bias = computeDirectionBias(elliott, ctx, 100);
    expect(bias.conflict || bias.dominant === "NEUTRAL").toBe(true);
    const r = decideOperation(elliott, ctx, [], 100);
    expect(r.decision === "WAIT" || r.decision === "NO_TRADE").toBe(true);
  });
});