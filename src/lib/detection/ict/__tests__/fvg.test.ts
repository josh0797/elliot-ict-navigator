import { describe, expect, it } from "vitest";
import { detectFVGs } from "../fvg";
import type { CandleV2 } from "../../schemas/analysis";

function c(i: number, o: number, h: number, l: number, cl: number): CandleV2 {
  return { index: i, time: 1_700_000_000 + i * 60, open: o, high: h, low: l, close: cl };
}

it("FVG: detects bullish gap", () => {
  const candles = [c(0, 100, 102, 99, 101), c(1, 101, 110, 100, 109), c(2, 110, 115, 105, 114)];
  const f = detectFVGs(candles);
  expect(f.length).toBe(1);
  expect(f[0].type).toBe("bullish");
  expect(f[0].bottom).toBe(102);
  expect(f[0].top).toBe(105);
});

it("FVG: detects bearish gap", () => {
  const candles = [c(0, 110, 112, 108, 109), c(1, 109, 110, 100, 101), c(2, 100, 105, 95, 96)];
  const f = detectFVGs(candles);
  expect(f.length).toBe(1);
  expect(f[0].type).toBe("bearish");
});
