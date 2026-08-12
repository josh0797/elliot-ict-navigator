/**
 * Map ElliottAnalysis (engine v2 internals) → ElliottResultDTO (public API).
 * Owns confidence scoring (0-100) with explicit buckets and rule reporting.
 */

import type { CandleV2 } from "../schemas/analysis";
import type { StructureBias } from "../structure/market-structure";
import {
  alternationScore,
  wave2Score,
  wave3Score,
  wave4Score,
  wave5Score,
} from "./scoring";
import type {
  Bias,
  ConfidenceBreakdown,
  ElliottAnalysis,
  ElliottCountV2,
  ElliottResultDTO,
  ElliottRuleResult,
  ElliottStatus,
  ElliottWaveDTO,
  FibTargetDTO,
  LabeledPivot,
  WaveLabel,
} from "./types";

const ISO = (unixSec: number) => new Date(unixSec * 1000).toISOString();

function priceAt(labeled: LabeledPivot[], label: WaveLabel): number | undefined {
  return labeled.find((l) => l.label === label)?.pivot.price;
}

function ruleMessage(code: string, status: "PASS" | "FAIL" | "PENDING"): string {
  const M: Record<string, Record<string, string>> = {
    W2_ORIGIN: {
      PASS: "Wave 2 remains beyond Wave 0",
      FAIL: "Wave 2 retraced past Wave 0 origin (>100% of Wave 1)",
      PENDING: "Wave 2 not yet formed",
    },
    W3_NOT_SHORTEST: {
      PASS: "Wave 3 is not the shortest among 1/3/5",
      FAIL: "Wave 3 is the shortest among 1/3/5",
      PENDING: "Wave 5 is not complete",
    },
    W4_OVERLAP: {
      PASS: "Wave 4 does not overlap Wave 1 territory",
      FAIL: "Wave 4 overlaps Wave 1 (only valid in diagonals)",
      PENDING: "Wave 4 not yet formed",
    },
  };
  return M[code]?.[status] ?? `${code} ${status}`;
}

function mandatoryRules(count: ElliottCountV2): ElliottRuleResult[] {
  const labels = new Set(count.labeled.map((l) => l.label));
  const invs = count.invalidations.join(" | ");
  const rules: ElliottRuleResult[] = [];

  // W2_ORIGIN
  if (!labels.has("2")) {
    rules.push({ code: "W2_ORIGIN", status: "PENDING", message: ruleMessage("W2_ORIGIN", "PENDING") });
  } else if (/R1:/.test(invs)) {
    rules.push({ code: "W2_ORIGIN", status: "FAIL", message: ruleMessage("W2_ORIGIN", "FAIL") });
  } else {
    rules.push({ code: "W2_ORIGIN", status: "PASS", message: ruleMessage("W2_ORIGIN", "PASS") });
  }

  // W3_NOT_SHORTEST — only definitive once wave 5 exists
  if (!labels.has("5")) {
    rules.push({ code: "W3_NOT_SHORTEST", status: "PENDING", message: ruleMessage("W3_NOT_SHORTEST", "PENDING") });
  } else if (/R2:/.test(invs)) {
    rules.push({ code: "W3_NOT_SHORTEST", status: "FAIL", message: ruleMessage("W3_NOT_SHORTEST", "FAIL") });
  } else {
    rules.push({ code: "W3_NOT_SHORTEST", status: "PASS", message: ruleMessage("W3_NOT_SHORTEST", "PASS") });
  }

  // W4_OVERLAP
  if (!labels.has("4")) {
    rules.push({ code: "W4_OVERLAP", status: "PENDING", message: ruleMessage("W4_OVERLAP", "PENDING") });
  } else if (/R3:/.test(invs)) {
    rules.push({ code: "W4_OVERLAP", status: "FAIL", message: ruleMessage("W4_OVERLAP", "FAIL") });
  } else {
    rules.push({ code: "W4_OVERLAP", status: "PASS", message: ruleMessage("W4_OVERLAP", "PASS") });
  }

  return rules;
}

function softRules(count: ElliottCountV2): ElliottRuleResult[] {
  const f = count.fibScores;
  const out: ElliottRuleResult[] = [];
  const add = (code: ElliottRuleResult["code"], v: number | null, name: string) => {
    if (v === null) {
      out.push({ code, status: "PENDING", message: `${name} not measurable yet` });
    } else if (v >= 0.5) {
      out.push({ code, status: "PASS", message: `${name} score ${(v * 100).toFixed(0)}%` });
    } else {
      out.push({ code, status: "FAIL", message: `${name} weak (${(v * 100).toFixed(0)}%)` });
    }
  };
  add("W2_RETRACE", f.wave2Retracement, "Wave 2 Fibonacci retracement");
  add("W3_EXTENSION", f.wave3Extension, "Wave 3 Fibonacci extension");
  add("W4_ALTERNATION", count.alternation, "W2/W4 alternation");
  add("W5_PROJECTION", f.wave5Projection, "Wave 5 Fibonacci projection");
  return out;
}

function pivotClarity(count: ElliottCountV2): number {
  if (count.labeled.length === 0) return 0;
  let sum = 0;
  for (const l of count.labeled) {
    // Confirmed pivots count fully; provisional half. ATR distance >= 1 saturates.
    const conf = l.pivot.confirmed ? 1 : 0.5;
    const atr = Math.min(1, l.pivot.atrDistance);
    sum += conf * (0.5 + 0.5 * atr);
  }
  return sum / count.labeled.length;
}

function timeDuration(count: ElliottCountV2): number {
  // Reward W3 lasting longer than W1, W5 not too compressed.
  const ps = count.labeled.map((l) => l.pivot);
  if (ps.length < 4) return 0.3;
  const w1Bars = ps[1].index - ps[0].index;
  const w3Bars = ps[3] ? ps[3].index - ps[2].index : 0;
  if (w3Bars === 0) return 0.3;
  const ratio = w3Bars / Math.max(1, w1Bars);
  if (ratio >= 1 && ratio <= 3) return 1;
  if (ratio > 0.6) return 0.6;
  return 0.3;
}

function biasAlignment(direction: "long" | "short", structureBias: StructureBias): number {
  if (structureBias === "NEUTRAL") return 0.5;
  if (direction === "long" && structureBias === "BULLISH") return 1;
  if (direction === "short" && structureBias === "BEARISH") return 1;
  return 0;
}

function fibBucketAvg(count: ElliottCountV2): number {
  const xs = [
    count.fibScores.wave2Retracement,
    count.fibScores.wave3Extension,
    count.fibScores.wave4Retracement,
    count.fibScores.wave5Projection,
  ].filter((v): v is number => v !== null);
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Recompute soft fib + alternation scores using PASSED candidate prices
 * (the engine already populated `fibScores`; we just re-derive here for
 * completeness when downstream code mutates labeled pivots).
 */
function recomputeSoft(count: ElliottCountV2): void {
  const p = (label: WaveLabel) => priceAt(count.labeled, label);
  const p0 = p("0"), p1 = p("1"), p2 = p("2"), p3 = p("3"), p4 = p("4"), p5 = p("5");
  if (p0 !== undefined && p1 !== undefined && p2 !== undefined) {
    count.fibScores.wave2Retracement = wave2Score(p0, p1, p2);
  }
  if (p0 !== undefined && p1 !== undefined && p2 !== undefined && p3 !== undefined) {
    count.fibScores.wave3Extension = wave3Score(p0, p1, p2, p3);
  }
  if (p2 !== undefined && p3 !== undefined && p4 !== undefined) {
    count.fibScores.wave4Retracement = wave4Score(p2, p3, p4);
  }
  if (p0 !== undefined && p1 !== undefined && p4 !== undefined && p5 !== undefined) {
    count.fibScores.wave5Projection = wave5Score(p0, p1, p4, p5);
  }
  if (p0 !== undefined && p1 !== undefined && p2 !== undefined && p3 !== undefined && p4 !== undefined) {
    count.alternation = alternationScore(p0, p1, p2, p3, p4);
  }
}

export function computeConfidence(
  count: ElliottCountV2,
  structureBias: StructureBias,
): { confidence: number; breakdown: ConfidenceBreakdown } {
  // Hard invalidation → confidence is zero.
  if (count.state === "INVALIDATED") {
    return {
      confidence: 0,
      breakdown: { mandatoryRules: 0, alternation: 0, fibonacci: 0, pivotClarity: 0, timeDuration: 0, marketStructure: 0 },
    };
  }
  recomputeSoft(count);

  // Mandatory bucket: each of 3 rules contributes; PENDING counts half.
  const rules = mandatoryRules(count);
  let mScore = 0;
  for (const r of rules) {
    if (r.status === "PASS") mScore += 1;
    else if (r.status === "PENDING") mScore += 0.5;
  }
  const mandatoryRulesPts = (mScore / 3) * 25;

  const alternationPts = (count.alternation ?? 0) * 20;
  const fibonacciPts = fibBucketAvg(count) * 20;
  const pivotClarityPts = pivotClarity(count) * 15;
  const timeDurationPts = timeDuration(count) * 10;
  const marketStructurePts = biasAlignment(count.direction, structureBias) * 10;

  const breakdown: ConfidenceBreakdown = {
    mandatoryRules: round(mandatoryRulesPts),
    alternation: round(alternationPts),
    fibonacci: round(fibonacciPts),
    pivotClarity: round(pivotClarityPts),
    timeDuration: round(timeDurationPts),
    marketStructure: round(marketStructurePts),
  };

  const total =
    breakdown.mandatoryRules +
    breakdown.alternation +
    breakdown.fibonacci +
    breakdown.pivotClarity +
    breakdown.timeDuration +
    breakdown.marketStructure;

  return { confidence: Math.round(Math.max(0, Math.min(100, total))), breakdown };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function statusFor(count: ElliottCountV2): ElliottStatus {
  switch (count.state) {
    case "INVALIDATED": return "INVALIDATED";
    case "NO_COUNT":    return "NO_COUNT";
    case "DEVELOPING":  return "DEVELOPING";
    case "COMPLETED":   return "COMPLETED";
    case "VALID":       return "VALID";
  }
}

function completionFor(count: ElliottCountV2): number {
  const labels = new Set(count.labeled.map((l) => l.label));
  const impulse = ["0", "1", "2", "3", "4", "5"].filter((l) => labels.has(l as WaveLabel)).length;
  const corrective = ["A", "B", "C", "W", "X", "Y", "Z"].filter((l) => labels.has(l as WaveLabel)).length;
  if (corrective > 0) return Math.min(1, (impulse - 1 + corrective) / 8);
  return Math.min(1, Math.max(0, (impulse - 1) / 5));
}

function invalidationLevelFor(count: ElliottCountV2): number | null {
  const p = (label: WaveLabel) => priceAt(count.labeled, label);
  const cw = count.currentWave;
  if (!cw) return null;
  if (cw === "1" || cw === "2" || cw === "3") return p("0") ?? null;
  if (cw === "4") return p("1") ?? null;
  if (cw === "5") return p("4") ?? null;
  // Corrective legs (A/B/C, W/X/Y/Z): invalidation is the origin of the
  // correction — the end of wave 5 (or wave 3 when 4 is still unfolding).
  return p("5") ?? p("3") ?? null;
}

const IMPULSE_NEXT: Partial<Record<WaveLabel, WaveLabel>> = {
  "0": "1", "1": "2", "2": "3", "3": "4", "4": "5", "5": "A",
  A: "B", B: "C", C: "1",
  W: "X", X: "Y", Y: "Z", Z: "1",
};

function nextWaveFor(count: ElliottCountV2): WaveLabel | null {
  if (!count.currentWave) return null;
  if (count.state === "INVALIDATED") return null;
  return IMPULSE_NEXT[count.currentWave] ?? null;
}

/**
 * Confirmation level for the wave in progress: the price whose break
 * validates continuation (e.g. breaking wave-3 high confirms wave 5).
 */
function confirmationLevelFor(count: ElliottCountV2): number | null {
  const p = (label: WaveLabel) => priceAt(count.labeled, label);
  switch (count.currentWave) {
    case "1": return p("1") ?? null;
    case "2": return p("1") ?? null;
    case "3": return p("3") ?? null;
    case "4": return p("3") ?? null;
    case "5": return p("5") ?? null;
    case "A": case "B": case "C": return p("A") ?? null;
    case "W": case "X": case "Y": case "Z": return p("W") ?? null;
    default: return null;
  }
}

/** Fibonacci projections anchored correctly (extension measured from the retracement end). */
function fibTargetsFor(count: ElliottCountV2): FibTargetDTO[] {
  const p = (label: WaveLabel) => priceAt(count.labeled, label);
  const out: FibTargetDTO[] = [];
  const p0 = p("0"), p1 = p("1"), p2 = p("2"), p3 = p("3"), p4 = p("4"), p5 = p("5");
  const cw = count.currentWave;

  if (cw === "2" && p0 !== undefined && p1 !== undefined) {
    for (const r of [0.382, 0.5, 0.618, 0.786]) {
      out.push({ label: `W2 ${(r * 100).toFixed(1)}% retr`, ratio: r, price: p1 - (p1 - p0) * r, kind: "RETRACEMENT" });
    }
  }
  if ((cw === "2" || cw === "3") && p0 !== undefined && p1 !== undefined && p2 !== undefined) {
    for (const r of [1.0, 1.618, 2.618]) {
      out.push({ label: `W3 ${r}× W1`, ratio: r, price: p2 + (p1 - p0) * r, kind: "EXTENSION" });
    }
  }
  if (cw === "4" && p2 !== undefined && p3 !== undefined) {
    for (const r of [0.236, 0.382, 0.5]) {
      out.push({ label: `W4 ${(r * 100).toFixed(1)}% retr`, ratio: r, price: p3 - (p3 - p2) * r, kind: "RETRACEMENT" });
    }
  }
  if ((cw === "4" || cw === "5") && p0 !== undefined && p3 !== undefined && p4 !== undefined) {
    for (const r of [0.618, 1.0, 1.618]) {
      out.push({ label: `W5 ${r}× W1`, ratio: r, price: p4 + (p1 !== undefined && p0 !== undefined ? (p1 - p0) : (p3 - p0)) * r, kind: "PROJECTION" });
    }
  }
  if ((cw === "A" || cw === "B" || cw === "C") && p5 !== undefined) {
    const a = priceAt(count.labeled, "A");
    const b = priceAt(count.labeled, "B");
    if (a !== undefined && b !== undefined) {
      for (const r of [0.618, 1.0, 1.618]) {
        out.push({ label: `WC ${r}× WA`, ratio: r, price: b + (a - p5) * r, kind: "PROJECTION" });
      }
    }
  }
  if ((cw === "W" || cw === "X" || cw === "Y" || cw === "Z")) {
    const w = priceAt(count.labeled, "W");
    const x = priceAt(count.labeled, "X");
    const origin = p5 ?? p3;
    if (w !== undefined && x !== undefined && origin !== undefined) {
      for (const r of [1.0, 1.618]) {
        out.push({ label: `WY ${r}× WW`, ratio: r, price: x + (w - origin) * r, kind: "PROJECTION" });
      }
    }
  }
  return out.filter((t) => Number.isFinite(t.price));
}

function scenarioText(count: ElliottCountV2, next: WaveLabel | null): string {
  const dir = count.direction === "long" ? "alcista" : "bajista";
  const cw = count.currentWave ?? "?";
  const pat = count.pattern.replace(/_/g, " ").toLowerCase();
  if (count.state === "INVALIDATED") {
    return `Conteo ${dir} invalidado (${count.invalidations.join("; ") || "reglas no cumplidas"}). Se requiere recuento.`;
  }
  const base = `Estructura ${pat} ${dir}: onda ${cw} en curso`;
  return next ? `${base}; siguiente esperada: onda ${next}.` : `${base}.`;
}

function biasFor(count: ElliottCountV2): Bias {
  if (count.direction === "long") return "BULLISH";
  if (count.direction === "short") return "BEARISH";
  return "NEUTRAL";
}

function toWaveDTO(labeled: LabeledPivot[]): ElliottWaveDTO[] {
  return labeled.map((l) => ({
    label: l.label,
    index: l.pivot.index,
    time: ISO(l.pivot.time),
    price: l.pivot.price,
    type: l.pivot.type,
    confirmed: l.pivot.confirmed,
  }));
}

export function toElliottResult(
  analysis: ElliottAnalysis,
  structureBias: StructureBias,
  opts: { includeAlternatives?: boolean } = {},
): ElliottResultDTO {
  const includeAlternatives = opts.includeAlternatives ?? true;
  if (!analysis.primary) {
    return {
      status: "NO_COUNT",
      bias: "NEUTRAL",
      pattern: "IMPULSE",
      currentWave: null,
      nextWave: null,
      completion: 0,
      confidence: 0,
      invalidationLevel: null,
      rules: [],
      waves: [],
      alternatives: [],
    };
  }

  const toDTO = (count: ElliottCountV2, withAlts: boolean): ElliottResultDTO => {
    const { confidence, breakdown } = computeConfidence(count, structureBias);
    const rules = [...mandatoryRules(count), ...softRules(count)];
    const nextWave = nextWaveFor(count);
    return {
      status: statusFor(count),
      bias: biasFor(count),
      pattern: count.pattern,
      currentWave: count.currentWave,
      nextWave,
      scenario: scenarioText(count, nextWave),
      confirmationLevel: confirmationLevelFor(count),
      fibTargets: fibTargetsFor(count),
      degree: analysis.degree,
      pivotsUsed: analysis.pivotsUsed,
      completion: round(completionFor(count)),
      confidence,
      invalidationLevel: invalidationLevelFor(count),
      rules,
      waves: toWaveDTO(count.labeled),
      alternatives: withAlts ? analysis.alternatives.map((a) => toDTO(a, false)) : [],
      breakdown,
    };
  };

  return toDTO(analysis.primary, includeAlternatives);
}

/** Convenience used by tests: ignore candles, just bias from upstream. */
export function toElliottResultFromCandles(
  analysis: ElliottAnalysis,
  _candles: ReadonlyArray<CandleV2>,
  structureBias: StructureBias,
): ElliottResultDTO {
  return toElliottResult(analysis, structureBias);
}