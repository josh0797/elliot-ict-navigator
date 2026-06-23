import { test } from "vitest";
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

function pivProv(index: number, time: number, price: number, type: "HIGH" | "LOW"): PivotV2 {
  return { id: `p-${index}`, index, time, price, type, strength: "MAJOR", atrDistance: 1, confirmed: false };
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
    const swing = levels.find((l) => l.kind === "SWING_HIGH" && l.price === 110)!;
    const sw = sweeps.find((s) => s.targetLiquidityId === swing.id);
    assert.ok(sw);
    assert.equal(sw!.wickBeyond, true);
    assert.equal(sw!.closeBack, true);
    assert.ok(sw!.targetLiquidityId.startsWith("liq-"));
    assert.ok(sw!.quality > 50);
});

test("Phase 6 — EQH ignores provisional (unconfirmed) pivots", () => {
  const t0 = 1_700_000_000;
  const step = 3600;
  const candles: CandleV2[] = Array.from({ length: 30 }, (_, i) => c(i, t0 + i * step, 100, 101, 99, 100));
  const pivots: PivotV2[] = [
    piv(5, candles[5].time, 110, "HIGH"),         // confirmed
    pivProv(15, candles[15].time, 110, "HIGH"),    // provisional → must NOT cluster
  ];
  const levels = detectLiquidity(pivots, candles);
  assert.equal(levels.filter((l) => l.kind === "EQH").length, 0, "no EQH should form with one provisional pivot");
});

test("Phase 6 — clean close beyond level marks BROKEN, not SWEPT", () => {
  const t0 = 1_700_000_000;
  const step = 3600;
  const candles: CandleV2[] = [];
  for (let i = 0; i < 20; i++) candles.push(c(i, t0 + i * step, 100, 100.5, 99.5, 100));
  candles.push(c(20, t0 + 20 * step, 110, 110, 110, 110)); // pivot bar
  // Single bar that wicks AND closes well above the level → clean breakout.
  candles.push(c(21, t0 + 21 * step, 111, 115, 110.5, 114));
  for (let i = 22; i < 30; i++) candles.push(c(i, t0 + i * step, 114, 115, 113, 114));
  const pivots = [piv(20, candles[20].time, 110, "HIGH")];
  const levels = detectLiquidity(pivots, candles);
  const swing = levels.find((l) => l.kind === "SWING_HIGH" && l.price === 110)!;
  assert.equal(swing.state, "BROKEN");
});

test("Phase 6 — wick past + close back marks SWEPT (stop hunt)", () => {
  const t0 = 1_700_000_000;
  const step = 3600;
  const candles: CandleV2[] = [];
  for (let i = 0; i < 20; i++) candles.push(c(i, t0 + i * step, 100, 100.5, 99.5, 100));
  candles.push(c(20, t0 + 20 * step, 110, 110, 110, 110)); // pivot bar
  // Wick to 112, close back at 108 → genuine sweep.
  candles.push(c(21, t0 + 21 * step, 109, 112, 107, 108));
  for (let i = 22; i < 30; i++) candles.push(c(i, t0 + i * step, 108, 109, 107, 108));
  const pivots = [piv(20, candles[20].time, 110, "HIGH")];
  const levels = detectLiquidity(pivots, candles);
  const swing = levels.find((l) => l.kind === "SWING_HIGH" && l.price === 110)!;
  assert.ok(swing.state === "SWEPT" || swing.state === "MITIGATED", `expected SWEPT/MITIGATED, got ${swing.state}`);
});

test("Phase 6 — daily timeframe suppresses ASIA_* and SESSION_* levels", () => {
  const t0 = 1_700_000_000;
  const dayStep = 86400;
  // 5 daily bars, all stamped at 00:00 UTC.
  const candles: CandleV2[] = Array.from({ length: 5 }, (_, i) => c(i, t0 + i * dayStep, 100, 101, 99, 100));
  const daily = detectLiquidity([], candles, { timeframe: "1d" });
  assert.equal(daily.filter((l) => l.kind === "ASIA_HIGH" || l.kind === "ASIA_LOW").length, 0);
  assert.equal(daily.filter((l) => l.kind === "SESSION_HIGH" || l.kind === "SESSION_LOW").length, 0);
});

test("Phase 6 — current SESSION_HIGH/LOW is marked provisional", () => {
  const t0 = Math.floor(Date.UTC(2024, 0, 8, 0, 0, 0) / 1000); // Mon 00:00 UTC
  const step = 3600;
  const candles: CandleV2[] = Array.from({ length: 6 }, (_, i) => c(i, t0 + i * step, 100, 101, 99, 100));
  const levels = detectLiquidity([], candles, { timeframe: "1h" });
  const sh = levels.find((l) => l.kind === "SESSION_HIGH");
  const sl = levels.find((l) => l.kind === "SESSION_LOW");
  assert.ok(sh && sh.provisional, "session high must be provisional");
  assert.ok(sl && sl.provisional, "session low must be provisional");
});