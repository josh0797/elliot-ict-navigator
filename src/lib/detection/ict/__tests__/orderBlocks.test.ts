import { test } from "vitest";
import assert from "node:assert/strict";
import { detectOrderBlocks } from "../orderBlocks";
import { detectFVGs } from "../fvg";
import type { CandleV2 } from "../../schemas/analysis";
import type { StructureEvent } from "../types";

function c(i: number, open: number, high: number, low: number, close: number, volume = 1000): CandleV2 {
  return { index: i, time: 1700000000 + i * 3600, open, high, low, close, volume };
}

test("OB Phase 5: rejects a lone opposite candle without displacement+BOS+FVG", () => {
  // 25 flat candles, one bearish, no displacement.
  const candles: CandleV2[] = [];
  for (let i = 0; i < 25; i++) candles.push(c(i, 100, 101, 99, 100.5));
  candles[20] = c(20, 101, 101.2, 100.8, 100.9); // tiny bearish
  const fvgs = detectFVGs(candles);
  const obs = detectOrderBlocks(candles, fvgs, []);
  assert.equal(obs.length, 0);
});

test("OB Phase 5: emits bullish OB with displacement + BOS + FVG", () => {
  const candles: CandleV2[] = [];
  // Stable ATR seed.
  for (let i = 0; i < 20; i++) candles.push(c(i, 100, 100.5, 99.5, 100));
  // Bearish candle (OB origin).
  candles.push(c(20, 100, 100.2, 99.6, 99.7));
  // Displacement bullish candle creating a bullish FVG (low > candles[19].high).
  candles.push(c(21, 99.8, 103, 99.8, 102.8));
  // Confirmation candle: low (101) > candles[20].high (100.2) → bullish FVG at i=21.
  candles.push(c(22, 102.8, 103.5, 101, 103.2));
  // Couple more bars to allow lifecycle scan.
  candles.push(c(23, 103.2, 103.8, 102.9, 103.5));
  candles.push(c(24, 103.5, 104.0, 103.0, 103.8));

  const fvgs = detectFVGs(candles);
  const bos: StructureEvent[] = [
    {
      id: "bos-22-l", type: "BOS", direction: "long",
      price: 100.5, time: candles[22].time, index: 22,
      state: "CONFIRMED", brokenPivotId: "p-22-h",
      breakIndex: 22, breakPrice: candles[22].close,
      closeBeyondAtr: 2, displacement: true,
    },
  ];
  const obs = detectOrderBlocks(candles, fvgs, bos);
  assert.equal(obs.length, 1, "should emit exactly one OB");
  const ob = obs[0];
  assert.equal(ob.type, "BULLISH");
  assert.equal(ob.displacementConfirmed, true);
  assert.equal(ob.bosConfirmed, true);
  assert.equal(ob.fvgAssociated, true);
  assert.ok(ob.bosRef && ob.fvgRef);
  assert.ok(ob.quality >= 75, `quality ${ob.quality} should be >= 75`);
  assert.ok(["FRESH", "TOUCHED", "MITIGATED"].includes(ob.state));
});

test("OB lifecycle: invalidates when close pierces opposite side", () => {
  const candles: CandleV2[] = [];
  for (let i = 0; i < 20; i++) candles.push(c(i, 100, 100.5, 99.5, 100));
  candles.push(c(20, 100, 100.2, 99.6, 99.7));     // bearish origin
  candles.push(c(21, 99.8, 103, 99.8, 102.8));     // displacement
  candles.push(c(22, 102.8, 103.5, 101, 103.2));   // FVG confirm
  // Invalidation: candle closes below the OB bottom (99.6).
  candles.push(c(23, 103, 103, 99.0, 99.0));

  const fvgs = detectFVGs(candles);
  const bos: StructureEvent[] = [
    {
      id: "bos-22-l", type: "BOS", direction: "long",
      price: 100.5, time: candles[22].time, index: 22,
      state: "CONFIRMED", brokenPivotId: "p-22-h",
      breakIndex: 22, breakPrice: candles[22].close,
      closeBeyondAtr: 2, displacement: true,
    },
  ];
  const obs = detectOrderBlocks(candles, fvgs, bos);
  assert.equal(obs.length, 1);
  assert.ok(["INVALIDATED", "BREAKER"].includes(obs[0].state));
});