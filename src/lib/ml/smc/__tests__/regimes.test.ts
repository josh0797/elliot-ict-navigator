import { describe, expect, it } from "vitest";
import { classifySmcRegime } from "../regimes";
import {
  continuationCandles,
  ctxFrom,
  flatCandles,
  structureEvent,
  sweep,
  sweepReversalCandles,
} from "./fixtures";

describe("classifySmcRegime", () => {
  it("classifies LIQUIDITY_REVERSAL", () => {
    const candles = sweepReversalCandles();
    const res = classifySmcRegime(
      ctxFrom(candles, {
        sweeps: [sweep({ time: candles[candles.length - 2].time, index: candles.length - 2 })],
        structure: [structureEvent({ time: candles[candles.length - 1].time })],
      }),
    );
    expect(res.regime).toBe("LIQUIDITY_REVERSAL");
    expect(res.flags.sweepAgainstDirection).toBe(true);
    expect(res.flags.sweepCloseBack).toBe(true);
    expect(res.reasons).toContain("sweep_SSL_recent");
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it("classifies MOMENTUM_CONTINUATION", () => {
    const candles = continuationCandles();
    const res = classifySmcRegime(
      ctxFrom(candles, {
        structure: [structureEvent({ time: candles[candles.length - 2].time })],
      }),
    );
    expect(res.regime).toBe("MOMENTUM_CONTINUATION");
    expect(res.flags.directionalExpansion).toBe(true);
    expect(res.reasons).toContain("directional_expansion");
  });

  it("returns UNKNOWN when evidence is insufficient", () => {
    const res = classifySmcRegime(ctxFrom(flatCandles()));
    expect(res.regime).toBe("UNKNOWN");
    expect(res.reasons).toContain("insufficient_evidence");
  });

  it("does not force continuation when a fresh opposite sweep conflicts", () => {
    const candles = continuationCandles();
    const res = classifySmcRegime(
      ctxFrom(candles, {
        sweeps: [
          sweep({
            side: "BSL",
            type: "buy_side",
            time: candles[candles.length - 1].time,
            index: candles.length - 1,
            closeBack: true,
          }),
        ],
      }),
    );
    expect(res.flags.conflictingReversal).toBe(true);
    expect(res.regime).toBe("UNKNOWN");
  });
});
