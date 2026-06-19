import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLiquidity } from "../liquidity";
import { detectSweeps } from "../sweeps";
import type { CandleV2, PivotV2 } from "../../schemas/analysis";

function c(index: number, time: number, o: number, h: number, l: number, close: number): CandleV2 {
  return { index, time, open: o, high: h, low: l, close };
}

function piv(index: number, time: number, price: number, type: "HIGH" | "LOW"): PivotV2 {
  return { id: `p-${index}`, index, time, price, type, strength: "MAJOR", atrDistance: 1, confirmed: true };
}

test("Phase 6 — clusters equal highs into a single BSL level", () => {
    const t0 = 1_700_000_000;
    const step = 3600;
    const candles: CandleV2[] = Array.from({ length: 40 }, (_, i) => c(i, t0 + i * step, 100, 101, 99, 100));
    const pivots: PivotV2[] = [
      piv(5, candles[5].time, 110.00, "HIGH"),
      piv(15, candles[15].time, 110.05, "HIGH"),
      piv(25, candles[25].time, 110.02, "HIGH"),
    ];
    const levels = detectLiquidity(pivots, candles);
    const eqh = levels.find((l) => l.kind === "EQH");
    assert.ok(eqh);
    assert.equal(eqh!.touches, 3);
    assert.equal(eqh!.side, "BSL");
    assert.equal(eqh!.state, "ACTIVE");
});

test("Phase 6 — marks a level SWEPT when wick exceeds it", () => {
    const t0 = 1_700_000_000;
    const step = 3600;
    const candles: CandleV2[] = [];
    for (let i = 0; i < 20; i++) candles.push(c(i, t0 + i * step, 100, 100.5, 99.5, 100));
    candles.push(c(20, t0 + 20 * step, 110, 110, 110, 110));
    for (let i = 21; i < 30; i++) candles.push(c(i, t0 + i * step, 105, 106, 104, 105));
    candles.push(c(30, t0 + 30 * step, 109, 112, 108, 108));
    for (let i = 31; i < 40; i++) candles.push(c(i, t0 + i * step, 107, 111, 105, 108));
    const pivots = [piv(20, candles[20].time, 110, "HIGH")];
    const levels = detectLiquidity(pivots, candles);
    const swing = levels.find((l) => l.kind === "SWING_HIGH" && l.price === 110);
    assert.ok(swing);
    assert.ok(swing!.state === "SWEPT" || swing!.state === "MITIGATED");
});

test("Phase 6 — detectSweeps records stop-hunt with closeBack and target link", () => {
    const t0 = 1_700_000_000;
    const step = 3600;
    const candles: CandleV2[] = [];
    for (let i = 0; i < 10; i++) candles.push(c(i, t0 + i * step, 100, 100.5, 99.5, 100));
    candles.push(c(10, t0 + 10 * step, 110, 110, 110, 110));
    for (let i = 11; i < 20; i++) candles.push(c(i, t0 + i * step, 105, 106, 104, 105));
    candles.push(c(20, t0 + 20 * step, 108, 112, 107, 108));
    const pivots = [piv(10, candles[10].time, 110, "HIGH")];
    const levels = detectLiquidity(pivots, candles);
    const sweeps = detectSweeps(candles, levels, []);
    const sw = sweeps.find((s) => s.type === "buy_side");
    assert.ok(sw);
    assert.equal(sw!.wickBeyond, true);
    assert.equal(sw!.closeBack, true);
    assert.ok(sw!.targetLiquidityId.startsWith("liq-"));
    assert.ok(sw!.quality > 50);
});