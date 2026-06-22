import { test } from "node:test";
import assert from "node:assert/strict";
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

function bullishIct(currentIndex: number): IctContext {
  return {
    bias: "BULLISH",
    fvgs: [],
    orderBlocks: [
      {
        id: "ob1",
        type: "BULLISH",
        top: 104.5,
        bottom: 103.5,
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
      { id: "lq1", side: "BSL", kind: "PDH", price: 115, time: 0, originIndices: [10], touches: 2, state: "ACTIVE", sweptAtIndex: null, sweptAtTime: null, strength: 70 },
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

test("setup engine produces a long signal with positive RR when bullish confluences align", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  assert.ok(out.length > 0, "expected at least one signal");
  const s = out[0];
  assert.equal(s.direction, "long");
  assert.ok(s.rrToTp1 > 1, `RR>1 expected, got ${s.rrToTp1}`);
  assert.ok(s.score > 0.5, `score>0.5 expected, got ${s.score}`);
  assert.ok(s.confluences.includes("BIAS_ALIGN"));
  assert.ok(s.confluences.includes("OB_CONFLUENCE"));
  assert.notEqual(s.mlScore, null);
  assert.equal(s.modelVersion, "legacy-pretrained-html-v1");
});

test("setup engine returns no signals when Elliott is INVALIDATED", () => {
  const elliott = bullishElliott();
  elliott.primary!.state = "INVALIDATED";
  const ict = bullishIct(candles.length - 1);
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  assert.deepEqual(out, []);
});

test("setup engine returns no signals when there are no matching POIs", () => {
  const elliott = bullishElliott();
  const ict = bullishIct(candles.length - 1);
  ict.orderBlocks = [];
  ict.fvgs = [];
  const out = detectSignals(candles, [], elliott, ict, { symbol, timeframe });
  assert.deepEqual(out, []);
});

test("setup engine returns no signals when primary is null", () => {
  const out = detectSignals(candles, [], { primary: null, alternatives: [] }, bullishIct(candles.length - 1), { symbol, timeframe });
  assert.deepEqual(out, []);
});