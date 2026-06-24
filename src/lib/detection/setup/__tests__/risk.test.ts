import { describe, expect, it } from "vitest";
import { computeStopLoss } from "../risk";

describe("computeStopLoss — side & validity", () => {
  it("long: SL is below entry when poiDistal is below entry", () => {
    const r = computeStopLoss({
      direction: "long", entry: 100, poiDistal: 99,
      atr: 1, atrBufferMultiplier: 0.1,
      elliottInvalidation: 95, sweepExtreme: 98, protectedSwing: 97,
    });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.price).toBeLessThan(100);
      expect(r.basis.chosen).toBe("min");
    }
  });

  it("short: SL is above entry", () => {
    const r = computeStopLoss({
      direction: "short", entry: 100, poiDistal: 101,
      atr: 1, atrBufferMultiplier: 0.1,
      elliottInvalidation: 105, sweepExtreme: 102, protectedSwing: 103,
    });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.price).toBeGreaterThan(100);
      expect(r.basis.chosen).toBe("max");
    }
  });

  it("rejects when every candidate is on the wrong side of entry", () => {
    const r = computeStopLoss({
      direction: "long", entry: 100, poiDistal: 101, // above
      atr: 1, atrBufferMultiplier: 0.1,
      elliottInvalidation: 102, sweepExtreme: 103, protectedSwing: 104,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toBe("NO_VALID_STRUCTURAL_STOP");
  });

  it("rejects when ATR is invalid", () => {
    const r = computeStopLoss({
      direction: "long", entry: 100, poiDistal: 99,
      atr: 0, atrBufferMultiplier: 0.1,
      elliottInvalidation: null, sweepExtreme: null, protectedSwing: null,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toBe("INVALID_ATR");
  });

  it("rejects when stop is further than 12·ATR", () => {
    const r = computeStopLoss({
      direction: "long", entry: 100, poiDistal: 50, // 50 units away, atr=1 → too far
      atr: 1, atrBufferMultiplier: 0.1,
      elliottInvalidation: null, sweepExtreme: null, protectedSwing: null,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toBe("STOP_TOO_FAR");
  });
});