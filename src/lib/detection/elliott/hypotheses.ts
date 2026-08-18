/**
 * Objective hypothesis comparison.
 *
 * The engine no longer "decides" a shape implicitly: every reading (A-B-C
 * correction, complete impulse, diagonal, truncated fifth) is scored
 * independently and the highest score wins. Nothing forces ABC and nothing
 * forces an impulse.
 */
import type { PivotV2 } from "../schemas/analysis";
import type { CountState, ElliottCountV2, LabeledPivot, WaveLabel, WavePattern } from "./types";
import type { TruncationEvidence } from "./truncation";

export type HypothesisKind = "ABC" | "IMPULSE" | "DIAGONAL" | "TRUNCATED_FIFTH" | "UNCONFIRMED";

export interface HypothesisScore {
  kind: HypothesisKind;
  score: number;
  passedRules: string[];
  failedRules: string[];
  notes: string[];
  truncation?: TruncationEvidence;
}

const CORRECTIVE_PATTERNS: WavePattern[] = [
  "ZIGZAG",
  "FLAT",
  "DOUBLE_ZIGZAG",
  "TRIPLE_ZIGZAG",
  "SIMPLE_CORRECTION",
  "UNKNOWN_CORRECTION",
];

export function hypothesisKind(
  count: ElliottCountV2,
  truncation?: TruncationEvidence | null,
): HypothesisKind {
  if (CORRECTIVE_PATTERNS.includes(count.pattern)) return "ABC";
  if (count.pattern === "ENDING_DIAGONAL" || count.pattern === "LEADING_DIAGONAL")
    return "DIAGONAL";
  if (truncation?.verdict === "CONFIRMED") return "TRUNCATED_FIFTH";
  if (truncation?.verdict === "UNCONFIRMED") return "UNCONFIRMED";
  return "IMPULSE";
}

/** Number of Fibonacci / alternation guidelines the count fails. */
export function fibFailures(count: ElliottCountV2): string[] {
  const failed: string[] = [];
  const f = count.fibScores;
  const check = (name: string, v: number | null) => {
    if (v !== null && v < 0.5) failed.push(name);
  };
  check("W2_RETRACE", f.wave2Retracement);
  check("W3_EXTENSION", f.wave3Extension);
  check("W4_RETRACE", f.wave4Retracement);
  check("W5_PROJECTION", f.wave5Projection);
  check("W4_ALTERNATION", count.alternation);
  return failed;
}

/** Build a scored hypothesis from an engine count. */
export function buildHypothesis(
  count: ElliottCountV2,
  truncation?: TruncationEvidence | null,
): HypothesisScore {
  const kind = hypothesisKind(count, truncation);
  const failed = [...fibFailures(count), ...count.invalidations];
  const passed: string[] = [];
  const f = count.fibScores;
  const add = (name: string, v: number | null) => {
    if (v !== null && v >= 0.5) passed.push(name);
  };
  add("W2_RETRACE", f.wave2Retracement);
  add("W3_EXTENSION", f.wave3Extension);
  add("W4_RETRACE", f.wave4Retracement);
  add("W5_PROJECTION", f.wave5Projection);
  add("W4_ALTERNATION", count.alternation);
  if (!/R1:/.test(count.invalidations.join(" "))) passed.push("W2_ORIGIN");
  if (!/R2:/.test(count.invalidations.join(" "))) passed.push("W3_NOT_SHORTEST");
  if (!/R3:/.test(count.invalidations.join(" "))) passed.push("W4_OVERLAP");

  let score = count.score;
  const notes = [...count.notes];

  // Coverage: a reading that explains more structure beats a 3-pivot fragment
  // anchored at the live edge. Applied before the guideline penalties so a
  // long, slightly imperfect count still outranks a short "perfect" one.
  const coverage = Math.min(3, Math.max(0, count.labeled.length - 3));
  score += 0.06 * coverage;

  // An impulse reading that piles up guideline failures is a weak impulse: the
  // structure is more likely corrective. Two or more failures cost real score.
  if (kind === "IMPULSE" || kind === "UNCONFIRMED" || kind === "TRUNCATED_FIFTH") {
    const n = fibFailures(count).length;
    if (n >= 2) {
      score *= n >= 3 ? 0.75 : 0.88;
      notes.push(`impulse penalised: ${n} Fibonacci/alternation failures`);
    }
  }
  if (kind === "UNCONFIRMED") {
    score *= 0.85;
    notes.push("possible truncated fifth — unconfirmed (internal subwaves missing)");
  }
  if (kind === "TRUNCATED_FIFTH" && truncation) {
    notes.push(
      `truncated fifth confirmed: W3 ${truncation.wave3Extreme} vs W5 ${truncation.wave5Extreme}` +
        (truncation.gapAtr !== null ? ` (${truncation.gapAtr.toFixed(2)} ATR)` : ""),
    );
  }

  return {
    kind,
    score: Math.max(0, Math.min(1, score)),
    passedRules: Array.from(new Set(passed)),
    failedRules: Array.from(new Set(failed)),
    notes,
    truncation: truncation ?? undefined,
  };
}

/**
 * Standalone A-B-C hypothesis over the structural pool: three alternating legs
 * where B is a valid retracement of A and C travels in A's direction.
 * Returns null when the geometry is not corrective.
 */
export function detectAbcHypothesis(pool: ReadonlyArray<PivotV2>): ElliottCountV2 | null {
  if (pool.length < 3) return null;
  // Walk backwards keeping strict type alternation: origin, A, B, C.
  const tail: PivotV2[] = [pool[pool.length - 1]];
  for (let i = pool.length - 2; i >= 0 && tail.length < 4; i--) {
    if (pool[i].type === tail[0].type) break;
    tail.unshift(pool[i]);
  }
  if (tail.length < 3) return null;

  const origin = tail[0];
  const a = tail[1];
  const b = tail[2];
  const c = tail.length >= 4 ? tail[3] : null;

  const aLen = Math.abs(a.price - origin.price);
  if (aLen === 0) return null;
  const aUp = a.price > origin.price;
  const bRetr = Math.abs(b.price - a.price) / aLen;
  if (bRetr < 0.236 || bRetr > 1.382) return null;

  const labeled: LabeledPivot[] = [
    { pivot: origin, label: "0" as WaveLabel },
    { pivot: a, label: "A" },
    { pivot: b, label: "B" },
  ];
  let pattern: WavePattern = "SIMPLE_CORRECTION";
  let state: CountState = "DEVELOPING";
  let score = 0.42;
  const notes: string[] = ["A-B-C hypothesis scored independently"];

  if (bRetr >= 0.382 && bRetr <= 0.786) score += 0.12;
  else if (bRetr > 0.786) score += 0.08;

  if (c) {
    const cUp = c.price > b.price;
    if (cUp !== aUp) return null; // C must travel with A.
    labeled.push({ pivot: c, label: "C" });
    state = "COMPLETED";
    pattern = bRetr < 0.7 ? "ZIGZAG" : "FLAT";
    const cLen = Math.abs(c.price - b.price);
    const ratio = cLen / aLen;
    if (ratio >= 0.618 && ratio <= 1.618) score += 0.16;
    notes.push(`B retrace ${(bRetr * 100).toFixed(0)}% of A, C/A ${ratio.toFixed(2)}`);
  }
  if (labeled.every((l) => l.pivot.confirmed)) score += 0.05;

  return {
    direction: aUp ? "long" : "short",
    pattern,
    state,
    labeled,
    currentWave: labeled[labeled.length - 1].label,
    score: Math.min(1, score),
    fibScores: {
      wave2Retracement: null,
      wave3Extension: null,
      wave4Retracement: null,
      wave5Projection: null,
    },
    alternation: null,
    invalidations: [],
    notes,
  };
}
