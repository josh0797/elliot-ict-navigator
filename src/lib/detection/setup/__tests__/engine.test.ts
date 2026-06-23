import { describe, expect, it } from "vitest";
import { detectSignals } from "../engine";
import type { CandleV2, PivotV2 } from "../../schemas/analysis";
import type { ElliottAnalysis, ElliottCountV2 } from "../../elliott/types";
import type { IctContext } from "../../ict/types";

function mkCandles(n: number, basePrice: number): CandleV2[] {
  const out: CandleV2[] = [];
  for (let i = 0; i < n; i++) {
    const p = basePrice + Math.sin(i / 5) * 2;
    out.push({ index: i, time: 1_700_000_000 + i * 3600, open: p, high: p + 0.5, low: p - 0.5, close: p });
  }
  return out;
}

function mkPivot(i: number, type: "HIGH" | "LOW", price: number, time: number): PivotV2 {
  return { id: `${time}-${type}`, index: i, time, price, type, strength: "MAJOR", atrDistance: 1.5, confirmed: true };
}

function bullishElliott(): ElliottAnalysis {
  const t = 1_700_000_000;
  const labeled: ElliottCountV2["labeled"] = [
    { label: "0", pivot: mkPivot(0, "LOW", 100, t) },
    { label: "1", pivot: mkPivot(20, "HIGH", 110, t + 20 * 3600) },
    { label: "2", pivot: mkPivot(40, "LOW", 104, t + 40 * 3600) },
  ];
  const primary: ElliottCountV2 = {
    direction: "long",
    pattern: "IMPULSE",
    state: "DEVELOPING",
    labeled,
    currentWave: "2",
    score: 0.7,
    fibScores: { wave2Retracement: 0.8, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null,
    invalidations: [],
    notes: [],
  };
  return { primary, alternatives: [] };
}

function bullishIct(currentIndex: number, opts: { obTop?: number; obBottom?: number } = {}): IctContext {
  return {
    bias: "BULLISH",
    fvgs: [],
    orderBlocks: [
      {
        id: "ob1",
        type: "BULLISH",
        top: opts.obTop ?? 102.5,
        bottom: opts.obBottom ?? 101.5,
        originIndex: 38,
        originTime: 0,
        state: "FRESH",
        touchCount: 0,
        mitigationPercent: 0,
        displacementConfirmed: true,
        bosConfirmed: true,
        fvgAssociated: false,
        volumeConfirmation: false,
        bosRef: null,
        fvgRef: null,
        quality: 80,
        rangePolicy: "FULL_CANDLE",
      },
    ],
    liquidity: [
      { id: "lq1", side: "BSL", kind: "PDH", price: 115, time: 0, originIndices: [10], touches: 2, state: "ACTIVE", sweptAtIndex: null, sweptAtTime: null, strength: 70, provisional: false },
    ],
    sweeps: [
      { id: "sw1", side: "SSL", type: "sell_side", price: 102, time: 0, index: currentIndex - 2, targetLiquidityId: "x", wickBeyond: true, closeBack: true, displacementAfter: true, mitigated: false, quality: 80 },
    ],
    structure: [
      { id: "st1", type: "BOS", direction: "long", price: 110, time: 0, index: currentIndex - 3, state: "CONFIRMED", brokenPivotId: "p", breakIndex: currentIndex - 3, breakPrice: 110, closeBeyondAtr: 1.6, displacement: true },
    ],
    killzone: null,
    pdArray: { high: 115, low: 100, midpoint: 107.5, currentPrice: 104, zone: "DISCOUNT", position: 0.27 },
    score: 0.7,
  };
}

const candles = mkCandles(60, 104);
const symbol = "TEST", timeframe = "1h";

it("setup engine produces a long signal with positive RR when bullish confluences align", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out.length > 0).toBeTruthy();
  const s = out[0];
  expect(s.direction).toBe("long");
  expect(s.rrToTp1 > 1).toBeTruthy();
  expect(s.score > 0.5).toBeTruthy();
  expect(s.confluences.includes("BIAS_ALIGN")).toBeTruthy();
  expect(s.confluences.includes("OB_CONFLUENCE")).toBeTruthy();
  expect(s.mlScore).not.toBe(null);
  expect(s.modelVersion).toBe("legacy-pretrained-html-v1");
  expect(s.schemaVersion).toBe("canonical-setup-v2");
  expect(s.gatesPassed.length >= 10).toBeTruthy();
  expect(["BUY_LIMIT", "MARKET_BUY"].includes(s.orderType)).toBeTruthy();
});

it("setup engine returns no signals when Elliott is INVALIDATED", () => {
  const elliott = bullishElliott();
  elliott.primary!.state = "INVALIDATED";
  const ict = bullishIct(candles.length - 1);
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out).toEqual([]);
});

it("setup engine returns no signals when there are no matching POIs", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  ict.orderBlocks = [];
  ict.fvgs = [];
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out).toEqual([]);
});

it("setup engine returns no signals when primary is null", () => {
  const out = detectSignals(candles, [], { primary: null, alternatives: [] }, bullishIct(candles.length - 1), { symbol, timeframe });
  expect(out).toEqual([]);
});

it("hard gate: drops MITIGATED POIs", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  ict.orderBlocks[0].state = "MITIGATED";
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out).toEqual([]);
});

it("hard gate: requires structural confirmation (BOS or sweep+displacement)", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  ict.structure = [];
  ict.sweeps = [];
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out).toEqual([]);
});

it("hard gate: drops setups when RR is too small", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  // Liquidity right above entry → 2R fallback; force minRR very high.
  ict.liquidity = [];
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe, minRR: 99 });
  expect(out).toEqual([]);
});

it("entry policy: price inside POI yields MARKET_BUY / TRIGGERED", () => {
  // priceAtDetection ≈ candles[n-2].close. Force POI to straddle that close.
  const priceAtDet = candles[candles.length - 2].close;
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1, { obTop: priceAtDet + 0.5, obBottom: priceAtDet - 0.5 });
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out.length > 0).toBeTruthy();
  expect(out[0].orderType).toBe("MARKET_BUY");
  expect(out[0].status).toBe("TRIGGERED");
});

it("entry policy: price below POI long → BUY_LIMIT / WAITING_RETRACE", () => {
  const priceAtDet = candles[candles.length - 2].close;
  const elliott = bullishElliott();
  // POI sits comfortably above current price.
  const ict = bullishIct(candles.length - 1, { obTop: priceAtDet + 4, obBottom: priceAtDet + 2 });
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out.length > 0).toBeTruthy();
  expect(out[0].orderType).toBe("BUY_LIMIT");
  expect(out[0].status).toBe("WAITING_RETRACE");
});

it("TP1 policy: provisional liquidity is ignored, falls back to 2R", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  ict.liquidity = [{ ...ict.liquidity[0], provisional: true }];
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out.length > 0).toBeTruthy();
  expect(out[0].tp1Source.kind).toBe("FALLBACK");
});

it("TP2 policy: uses fib 1.618 extension when wave pivots are present", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out.length > 0).toBeTruthy();
  expect(out[0].tp2Source.kind).toBe("FIB_EXTENSION");
});

it("SL policy: slBasis records every contributing structural level", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  expect(out.length > 0).toBeTruthy();
  const sb = out[0].slBasis;
  expect(sb.elliottInvalidation).toBe(100);
  expect(sb.sweepExtreme).toBe(102);
  expect(sb.chosen).toBe("min");
  expect(out[0].sl < out[0].entry).toBeTruthy();
});