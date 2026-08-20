import { describe, expect, it } from "vitest";
import { buildSmcFeatures, SMC_FEATURE_COUNT, SMC_FEATURE_NAMES } from "../features";
import { SMC_FEATURE_SCHEMA_VERSION } from "../types";
import { continuationCandles, ctxFrom, flatCandles, sweep, sweepReversalCandles } from "./fixtures";

describe("SMC feature schema v1", () => {
  it("has a frozen, unique, deterministic ordering", () => {
    expect(SMC_FEATURE_NAMES.length).toBe(SMC_FEATURE_COUNT);
    expect(new Set(SMC_FEATURE_NAMES).size).toBe(SMC_FEATURE_COUNT);
    expect(SMC_FEATURE_NAMES[0]).toBe("london_minute_sin");
    const res = buildSmcFeatures(ctxFrom(flatCandles()));
    expect(res.schemaVersion).toBe(SMC_FEATURE_SCHEMA_VERSION);
    expect(res.vector.length).toBe(SMC_FEATURE_COUNT);
    expect(res.featureNames).toEqual(SMC_FEATURE_NAMES);
  });

  it("is pure — identical inputs give an identical vector", () => {
    const ctx = ctxFrom(sweepReversalCandles());
    expect(buildSmcFeatures(ctx).vector).toEqual(buildSmcFeatures(ctx).vector);
  });

  it("emits no NaN/Infinity on normal inputs", () => {
    const cases = [
      ctxFrom(flatCandles()),
      ctxFrom(sweepReversalCandles(), { atr: 0 }),
      ctxFrom(continuationCandles(), { direction: "short" }),
      ctxFrom(flatCandles(6)),
    ];
    for (const c of cases) {
      const { vector, named } = buildSmcFeatures(c);
      for (const v of vector) expect(Number.isFinite(v)).toBe(true);
      for (const k of SMC_FEATURE_NAMES) expect(Number.isFinite(named[k])).toBe(true);
    }
  });

  it("degrades gracefully on an empty series", () => {
    const res = buildSmcFeatures({ candles: [], atTime: 0, direction: "long", atr: 0 });
    expect(res.vector.length).toBe(SMC_FEATURE_COUNT);
    expect(res.vector.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("marks the empirical LONDON_PRE window and M30 timing", () => {
    const candles = flatCandles();
    const res = buildSmcFeatures(ctxFrom(candles));
    expect(res.named.session_london_pre).toBe(1);
    expect(res.named.exact_m30_boundary).toBe(1);
    expect(res.named.in_first_15m_after_m30).toBe(1);
  });

  it("ignores series data after the feature timestamp is truncated by the caller", () => {
    const full = continuationCandles();
    const truncated = full.slice(0, full.length - 1);
    const a = buildSmcFeatures(ctxFrom(truncated));
    const b = buildSmcFeatures(
      ctxFrom(truncated, {
        sweeps: [sweep({ time: full[full.length - 1].time + 600, index: full.length + 5 })],
      }),
    );
    expect(b.vector).toEqual(a.vector);
  });

  it("reflects recent sweep evidence", () => {
    const candles = sweepReversalCandles();
    const res = buildSmcFeatures(
      ctxFrom(candles, {
        sweeps: [sweep({ time: candles[candles.length - 2].time, index: candles.length - 2 })],
      }),
    );
    expect(res.named.sweep_ssl_recent).toBe(1);
    expect(res.named.sweep_close_back).toBe(1);
    expect(res.named.sweep_quality_norm).toBeCloseTo(0.7, 5);
  });
});
