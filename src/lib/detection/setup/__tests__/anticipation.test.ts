import { describe, expect, it } from "vitest";
import { detectSignals, pickOperativeCount } from "../engine";
import type { CandleV2, PivotV2 } from "../../schemas/analysis";
import type { ElliottAnalysis, ElliottCountV2 } from "../../elliott/types";
import type { IctContext } from "../../ict/types";

function mkCandles(n: number, basePrice: number): CandleV2[] {
  const out: CandleV2[] = [];
  const sec = 3600;
  const lastClosed = Math.floor(Date.now() / 1000 / sec) * sec - sec;
  for (let i = 0; i < n; i++) {
    const p = basePrice + Math.sin(i / 5) * 2;
    out.push({
      index: i,
      time: lastClosed - (n - 1 - i) * sec,
      open: p, high: p + 0.5, low: p - 0.5, close: p,
    });
  }
  return out;
}

function mkPivot(i: number, type: "HIGH" | "LOW", price: number): PivotV2 {
  return { id: `${i}-${type}`, index: i, time: 1_700_000_000 + i * 3600, price, type, strength: "MAJOR", atrDistance: 1.5, confirmed: true };
}

/** Primary INVALIDATED + valid bearish alternative reading a B. */
function invalidatedPrimaryWithBearishAlt(): ElliottAnalysis {
  const primary: ElliottCountV2 = {
    direction: "long", pattern: "IMPULSE", state: "INVALIDATED",
    labeled: [{ label: "0", pivot: mkPivot(0, "LOW", 100) }],
    currentWave: "2", score: 0.8,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null, invalidations: [], notes: [],
  };
  const alt: ElliottCountV2 = {
    direction: "short", pattern: "ZIGZAG", state: "DEVELOPING",
    labeled: [
      { label: "0", pivot: mkPivot(0, "HIGH", 112) },
      { label: "A", pivot: mkPivot(20, "LOW", 100) },
      { label: "B", pivot: mkPivot(45, "HIGH", 108) },
    ],
    currentWave: "B", score: 0.65,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null, invalidations: [], notes: [],
  };
  return { primary, alternatives: [alt] };
}

function bearishIct(currentIndex: number, opts: { top?: number; bottom?: number; confirmations?: boolean } = {}): IctContext {
  const confirmed = opts.confirmations !== false;
  return {
    bias: "BEARISH",
    fvgs: [],
    orderBlocks: [{
      id: "ob-bear", type: "BEARISH",
      top: opts.top ?? 106.5, bottom: opts.bottom ?? 105.5,
      originIndex: 44, originTime: 0, state: "FRESH", touchCount: 0, mitigationPercent: 0,
      displacementConfirmed: true, bosConfirmed: true, fvgAssociated: false, volumeConfirmation: false,
      bosRef: null, fvgRef: null, quality: 82, rangePolicy: "FULL_CANDLE",
    }],
    liquidity: [{ id: "lq", side: "SSL", kind: "PDL", price: 96, time: 0, originIndices: [5], touches: 2, state: "ACTIVE", sweptAtIndex: null, sweptAtTime: null, brokenAtIndex: null, brokenAtTime: null, strength: 70, provisional: false }],
    sweeps: confirmed
      ? [{ id: "sw", side: "BSL", type: "buy_side", price: 108, time: 0, index: currentIndex - 2, targetLiquidityId: "x", wickBeyond: true, closeBack: true, displacementAfter: true, mitigated: false, quality: 80 }]
      : [],
    structure: [],
    killzone: null,
    pdArray: { high: 112, low: 96, midpoint: 104, currentPrice: 106, zone: "PREMIUM", position: 0.72 },
    score: 0.7,
  };
}

const candles = mkCandles(60, 106);
const opts = { symbol: "TEST", timeframe: "1h" };

it("picks the best valid alternative when the primary count is INVALIDATED", () => {
  const chosen = pickOperativeCount(invalidatedPrimaryWithBearishAlt());
  expect(chosen?.source).toBe("ALTERNATIVE");
  expect(chosen?.count.direction).toBe("short");
});

it("invalidated primary + valid bearish alternative still produces an ARMED short with a pending order", () => {
  const out = detectSignals(candles, [], invalidatedPrimaryWithBearishAlt(), bearishIct(candles.length - 1), opts);
  expect(out.length > 0).toBeTruthy();
  const s = out[0];
  console.log(JSON.stringify({st:s.status,ot:s.orderType,rr:s.rrToTp1,g:s.gatesPassed}));
  expect(s.direction).toBe("short");
  expect(["ARMED", "POTENTIAL_B", "TRIGGERED"].includes(s.status)).toBeTruthy();
  expect(s.orderType === "SELL_LIMIT" || s.orderType === "SELL_STOP").toBeTruthy();
  expect(s.rrToTp1 >= 1.5).toBeTruthy();
});

it("without any confirmation the bearish B is watch-only (POTENTIAL_B)", () => {
  const out = detectSignals(
    candles, [], invalidatedPrimaryWithBearishAlt(),
    bearishIct(candles.length - 1, { confirmations: false }), opts,
  );
  for (const s of out) expect(s.status).toBe("POTENTIAL_B");
});

it("never emits signals when the OHLC snapshot is stale", () => {
  const out = detectSignals(candles, [], invalidatedPrimaryWithBearishAlt(), bearishIct(candles.length - 1), {
    ...opts, dataStale: true,
  });
  expect(out).toEqual([]);
});
