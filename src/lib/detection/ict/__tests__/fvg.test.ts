import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFVGs } from "../fvg";
import type { CandleV2 } from "../../schemas/analysis";

function c(i: number, o: number, h: number, l: number, cl: number): CandleV2 {
  return { index: i, time: 1_700_000_000 + i * 60, open: o, high: h, low: l, close: cl };
}

test("FVG: detects bullish gap", () => {
  const candles = [c(0, 100, 102, 99, 101), c(1, 101, 110, 100, 109), c(2, 110, 115, 105, 114)];
  const f = detectFVGs(candles);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "bullish");
  assert.equal(f[0].bottom, 102);
  assert.equal(f[0].top, 105);
});

test("FVG: detects bearish gap", () => {
  const candles = [c(0, 110, 112, 108, 109), c(1, 109, 110, 100, 101), c(2, 100, 105, 95, 96)];
  const f = detectFVGs(candles);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "bearish");
});
