import { describe, expect, it } from "vitest";
import type { PivotV2 } from "../../schemas/analysis";
import { evaluateTruncation } from "../truncation";
import { analyzeElliott } from "../engine";
import { detectAbcHypothesis } from "../hypotheses";
import { shouldReplaceScenario } from "../stability";

function pv(index: number, price: number, type: "HIGH" | "LOW", confirmed = true): PivotV2 {
  return {
    id: `${index}-${type}`,
    index,
    time: index,
    price,
    type,
    strength: "MAJOR",
    atrDistance: 2,
    confirmed,
  };
}

const TRUNC_GEOMETRY = {
  direction: "long" as const,
  pattern: "IMPULSE" as const,
  p0: 100,
  p1: 120,
  p2: 110,
  p3: 160,
  p4: 140,
  p5: 155,
};

describe("truncated fifth evidence", () => {
  it("confirms a real truncated fifth with five internal subwaves and exhaustion", () => {
    const ev = evaluateTruncation({
      ...TRUNC_GEOMETRY,
      internalLabels: ["1", "2", "3", "4", "5"],
      exhaustion: ["RSI_DIVERGENCE", "MOMENTUM_LOSS"],
      atr: 5,
    });
    expect(ev.verdict).toBe("CONFIRMED");
    expect(ev.internalSubwaves).toBe(5);
    expect(ev.gapPrice).toBe(5);
    expect(ev.gapAtr).toBe(1);
  });

  it("stays UNCONFIRMED without enough internal subwaves", () => {
    const ev = evaluateTruncation({
      ...TRUNC_GEOMETRY,
      internalLabels: ["1", "2", "3"],
      exhaustion: ["RSI_DIVERGENCE"],
    });
    expect(ev.verdict).toBe("UNCONFIRMED");
    expect(ev.missing.some((m) => m.startsWith("FIVE_INTERNAL_SUBWAVES"))).toBe(true);
  });

  it("never truncates from a failed W5 projection alone (wave 5 exceeded wave 3)", () => {
    const ev = evaluateTruncation({
      ...TRUNC_GEOMETRY,
      p5: 200, // beyond wave 3 → no truncation at all
      internalLabels: ["1", "2", "3", "4", "5"],
      exhaustion: ["RSI_DIVERGENCE", "MOMENTUM_LOSS"],
    });
    expect(ev.verdict).toBe("NONE");
  });

  it("does not confirm when the invalidation level was breached", () => {
    const ev = evaluateTruncation({
      ...TRUNC_GEOMETRY,
      internalLabels: ["1", "2", "3", "4", "5"],
      exhaustion: ["RSI_DIVERGENCE", "MOMENTUM_LOSS"],
      invalidationBreached: true,
    });
    expect(ev.verdict).toBe("UNCONFIRMED");
  });
});

describe("A-B-C hypothesis", () => {
  it("scores a clean three-leg correction and keeps canonical A/B/C labels", () => {
    const pool = [pv(0, 200, "HIGH"), pv(10, 150, "LOW"), pv(16, 180, "HIGH"), pv(26, 132, "LOW")];
    const abc = detectAbcHypothesis(pool);
    expect(abc).toBeTruthy();
    expect(abc!.labeled.map((l) => l.label)).toEqual(["0", "A", "B", "C"]);
    expect(abc!.direction).toBe("short");
    expect(abc!.score).toBeGreaterThan(0.5);
  });

  it("rejects a sequence whose C travels against A", () => {
    const pool = [pv(0, 200, "HIGH"), pv(10, 150, "LOW"), pv(16, 180, "HIGH"), pv(26, 260, "LOW")];
    expect(detectAbcHypothesis(pool)).toBeNull();
  });

  it("keeps a valid ABC as the reported scenario instead of an impulse reading", () => {
    // Three alternating corrective legs, no impulsive extension.
    const pivots = [
      pv(0, 200, "HIGH"),
      pv(12, 150, "LOW"),
      pv(20, 182, "HIGH"),
      pv(34, 131, "LOW"),
    ];
    const a = analyzeElliott(pivots, { degree: "MINOR" });
    const kinds = (a.hypotheses ?? []).map((h) => h.kind);
    expect(kinds).toContain("ABC");
    expect(a.primary!.labeled.some((l) => l.label === "5")).toBe(false);
  });
});

describe("scenario stability", () => {
  const count = (score: number, confirmed: boolean, index = 10) => ({
    direction: "long" as const,
    pattern: "IMPULSE" as const,
    state: "DEVELOPING" as const,
    labeled: [{ pivot: pv(index, 100, "LOW", confirmed), label: "0" as const }],
    currentWave: "0" as const,
    score,
    fibScores: {
      wave2Retracement: null,
      wave3Extension: null,
      wave4Retracement: null,
      wave5Projection: null,
    },
    alternation: null,
    invalidations: [],
    notes: [],
  });

  it("keeps the incumbent when the challenger does not beat the margin", () => {
    const d = shouldReplaceScenario(count(0.6, true), count(0.65, true));
    expect(d.replace).toBe(false);
    expect(d.reason).toBe("MARGIN_NOT_MET");
  });

  it("waits for a closed candle before switching scenario", () => {
    const d = shouldReplaceScenario(count(0.5, true), count(0.9, false));
    expect(d.replace).toBe(false);
    expect(d.reason).toBe("AWAITING_CLOSED_CANDLE");
  });

  it("switches once the challenger is confirmed and beats the margin", () => {
    const d = shouldReplaceScenario(count(0.5, true, 5), count(0.9, true, 8), {
      lastClosedIndex: 8,
    });
    expect(d.replace).toBe(true);
  });

  it("rejects a challenger anchored beyond the last closed candle", () => {
    const d = shouldReplaceScenario(count(0.5, true, 5), count(0.9, true, 12), {
      lastClosedIndex: 8,
    });
    expect(d.replace).toBe(false);
    expect(d.reason).toBe("AWAITING_CLOSED_CANDLE");
  });
});
