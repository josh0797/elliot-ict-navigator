import { describe, expect, it } from "vitest";
import { trueRange, atr } from "../indicators/atr";
import type { CandleV2 } from "../schemas/analysis";

function mkCandle(i: number, h: number, l: number, c: number): CandleV2 {
  return { index: i, time: i, open: l, high: h, low: l, close: c };
}

it("trueRange first bar = high - low", () => {
  const cs = [mkCandle(0, 10, 8, 9)];
  expect(trueRange(cs)[0]).toBe(2);
});

it("trueRange uses prev close on gaps", () => {
  const cs = [mkCandle(0, 10, 8, 9), mkCandle(1, 15, 12, 14)];
  // tr1 = max(15-12, |15-9|, |12-9|) = 6
  expect(trueRange(cs)[1]).toBe(6);
});

it("atr14 returns NaN until period bars accumulate, then RMA", () => {
  const cs: CandleV2[] = [];
  for (let i = 0; i < 20; i++) cs.push(mkCandle(i, 10 + i, 8 + i, 9 + i));
  const a = atr(cs, 14);
  expect(Number.isNaN(a[12])).toBeTruthy();
  expect(Number.isFinite(a[13])).toBeTruthy();
  expect(a[14] > 0).toBeTruthy();
  // For monotonic +1 series, TR after first bar is constant = 2; RMA converges to 2.
  expect(Math.abs(a[19] - 2) < 0.001).toBeTruthy();
});