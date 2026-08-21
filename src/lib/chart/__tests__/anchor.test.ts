import { describe, it, expect } from "vitest";
import { buildAnchorSeries, resolveAnchor, toSeconds } from "../anchor";

const DAY = 86_400;
const HOUR = 3_600;

function series(startSec: number, count: number, step: number) {
  return Array.from({ length: count }, (_, i) => ({ time: startSec + i * step }));
}

describe("toSeconds", () => {
  it("parses ISO strings, seconds and millis", () => {
    expect(toSeconds("1970-01-02T00:00:00.000Z")).toBe(DAY);
    expect(toSeconds(DAY)).toBe(DAY);
    expect(toSeconds(DAY * 1000)).toBe(DAY);
    expect(toSeconds("nope")).toBeNull();
    expect(toSeconds(null)).toBeNull();
  });
});

describe("resolveAnchor — extended visual series (XAU/USD 1day)", () => {
  const base = Date.UTC(2026, 0, 1) / 1000;
  // 400 visual days; analysis only used the LAST 100.
  const visual = series(base, 400, DAY);
  const analysis = visual.slice(300);
  const anchors = buildAnchorSeries(visual);
  const analysisTimes = analysis.map((c) => c.time);

  it("anchors an analysis-relative index at the correct timestamp, not chartCandles[index]", () => {
    const wave = { time: new Date(analysis[10].time * 1000).toISOString(), index: 10 };
    const res = resolveAnchor(anchors, wave, { analysisTimes });
    expect(res.mode).toBe("exact");
    expect(res.time).toBe(analysis[10].time);
    // Regression guard: the naive index lookup would have been 300 bars early.
    expect(res.time).not.toBe(visual[10].time);
  });

  it("resolves every analysis pivot exactly (no snapping needed, same timeframe)", () => {
    for (let i = 0; i < analysis.length; i += 7) {
      const res = resolveAnchor(
        anchors,
        { time: new Date(analysis[i].time * 1000).toISOString(), index: i },
        { analysisTimes },
      );
      expect(res.mode).toBe("exact");
      expect(res.time).toBe(analysis[i].time);
    }
  });

  it("anchors ICT sweeps (numeric time + analysis index) on the raiding candle", () => {
    const sweep = { time: analysis[42].time, index: 42 };
    const res = resolveAnchor(anchors, sweep, { analysisTimes });
    expect(res.time).toBe(analysis[42].time);
    expect(res.time).not.toBe(visual[42].time);
  });

  it("does not treat weekend gaps as snapping targets beyond tolerance", () => {
    // Remove two consecutive days (market closed) from the visual series.
    const withGap = buildAnchorSeries(visual.filter((_, i) => i !== 200 && i !== 201));
    const res = resolveAnchor(withGap, { time: visual[200].time }, { analysisTimes: undefined });
    // 1 bar of tolerance → the missing bar cannot be relocated 2 days away.
    expect(res.time).toBeNull();
    expect(res.reason).toBe("out-of-tolerance");
  });
});

describe("resolveAnchor — visualDepth=Auto (same series)", () => {
  const base = Date.UTC(2026, 5, 1) / 1000;
  const candles = series(base, 500, HOUR); // 1h
  const anchors = buildAnchorSeries(candles);
  const analysisTimes = candles.map((c) => c.time);

  it("behaves identically when analysis and chart series match", () => {
    for (const i of [0, 1, 250, 499]) {
      const res = resolveAnchor(
        anchors,
        { time: new Date(candles[i].time * 1000).toISOString(), index: i },
        { analysisTimes },
      );
      expect(res.mode).toBe("exact");
      expect(res.time).toBe(candles[i].time);
    }
  });

  it("snaps an HTF timestamp within one bar of tolerance", () => {
    const res = resolveAnchor(anchors, { time: candles[10].time + 600 }, { analysisTimes });
    expect(res.mode).toBe("snapped");
    expect(res.time).toBe(candles[10].time);
    expect(res.drift).toBe(600);
  });

  it("rejects timestamps outside the rendered range", () => {
    expect(resolveAnchor(anchors, { time: base - 10 * HOUR }, { analysisTimes }).time).toBeNull();
    expect(resolveAnchor(anchors, { time: base + 9_999 * HOUR }, { analysisTimes }).time).toBeNull();
  });

  it("reports anchors with no usable timestamp", () => {
    const res = resolveAnchor(anchors, { time: "garbage", index: null }, { analysisTimes });
    expect(res.time).toBeNull();
    expect(res.reason).toBe("no-timestamp");
  });
});
