import { describe, expect, it } from "vitest";
import { annotateTargets, scenarioConsistencyCheck } from "../scenario";
import { computeBiasSplit } from "../../decision/bias-split";
import type { ElliottResultDTO, FibTargetDTO } from "../../elliott/types";

const T = (label: string, price: number): FibTargetDTO => ({
  label, ratio: 1, price, kind: "PROJECTION",
});

function dto(over: Partial<ElliottResultDTO> = {}): ElliottResultDTO {
  return {
    status: "VALID",
    bias: "BULLISH",
    pattern: "IMPULSE",
    currentWave: "5",
    nextWave: "A",
    completion: 1,
    confidence: 80,
    invalidationLevel: 4200,
    rules: [],
    waves: [],
    alternatives: [],
    fibTargets: [T("W5 0.618", 4411), T("W5 1.0", 4470), T("W5 1.618", 4565)],
    ...over,
  };
}

describe("dynamic Fibonacci targets", () => {
  it("marks reached targets HIT and promotes the next to ACTIVE/NEXT", () => {
    const a = annotateTargets(dto().fibTargets!, "long", 4430);
    expect(a.targets.map((t) => t.state)).toEqual(["HIT", "ACTIVE", "NEXT"]);
    expect(a.active?.price).toBe(4470);
    expect(a.next?.price).toBe(4565);
    expect(a.allExceeded).toBe(false);
  });

  it("never leaves an active target below current price", () => {
    const a = annotateTargets(dto().fibTargets!, "long", 4600);
    expect(a.active).toBeNull();
    expect(a.allExceeded).toBe(true);
  });
});

describe("scenarioConsistencyCheck", () => {
  it("retires a scenario whose targets were all exceeded", () => {
    const r = scenarioConsistencyCheck(dto(), { currentPrice: 4600 });
    expect(r.scenario.status).toBe("STALE");
    expect(r.scenario.confidence).toBe(0);
    expect(r.primaryRetired).toBe(true);
    expect(r.issues).toContain("STALE_SCENARIO");
  });

  it("invalidates when price breaches the invalidation level", () => {
    const r = scenarioConsistencyCheck(dto(), { currentPrice: 4100 });
    expect(r.scenario.status).toBe("INVALIDATED");
    expect(r.scenario.confidence).toBe(0);
  });

  it("never reports COMPLETED without two exhaustion signals", () => {
    const r = scenarioConsistencyCheck(dto({ status: "COMPLETED" }), { currentPrice: 4430 });
    expect(r.scenario.status).toBe("NEAR_COMPLETION");
    expect(r.scenario.scenario).not.toMatch(/en curso/);
    expect(r.issues).toContain("COMPLETED_WITHOUT_EVIDENCE");
  });

  it("keeps wave 5 DEVELOPING before any target is reached", () => {
    const r = scenarioConsistencyCheck(dto(), { currentPrice: 4390 });
    expect(r.scenario.status).toBe("DEVELOPING");
    expect(r.scenario.scenario).toMatch(/en curso/);
  });

  it("promotes a surviving alternative when the primary is retired", () => {
    const alt = dto({ bias: "BEARISH", invalidationLevel: 4800, confidence: 55, fibTargets: [T("WC 1.0", 4200)] });
    const r = scenarioConsistencyCheck(dto({ alternatives: [alt] }), { currentPrice: 4600 });
    expect(r.promoted).not.toBeNull();
    expect(r.scenario.consistency?.issues).toContain("ALTERNATIVE_PROMOTED");
  });
});

describe("Elliott vs ICT reconciliation", () => {
  it("returns MIXED when both sides disagree with mass", () => {
    const split = computeBiasSplit({
      dominant: "BEARISH", bullScore: 3.5, bearScore: 3, conflict: false,
      votes: [
        { source: "ELLIOTT_PRIMARY", direction: "BULLISH", weight: 2, reason: "" },
        { source: "ELLIOTT_WAVE", direction: "BULLISH", weight: 1.5, reason: "" },
        { source: "ICT_STRUCTURE", direction: "BEARISH", weight: 2, reason: "" },
        { source: "ICT_BOS", direction: "BEARISH", weight: 1, reason: "" },
      ],
    });
    expect(split.elliottScore).toBe(3.5);
    expect(split.ictScore).toBe(-3);
    expect(split.finalBias).toBe("MIXED");
    expect(split.explanation).toMatch(/not aligned/);
  });

  it("agrees when both point the same way", () => {
    const split = computeBiasSplit({
      dominant: "BULLISH", bullScore: 4, bearScore: 0, conflict: false,
      votes: [
        { source: "ELLIOTT_PRIMARY", direction: "BULLISH", weight: 2, reason: "" },
        { source: "ICT_STRUCTURE", direction: "BULLISH", weight: 2, reason: "" },
      ],
    });
    expect(split.finalBias).toBe("BULLISH");
  });
});
