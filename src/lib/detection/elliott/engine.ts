/**
 * Elliott engine v2 — orchestrates candidates → rules → scoring → corrective.
 * Pure-function: takes pivots, returns analysis. No I/O.
 */

import type { PivotV2 } from "../schemas/analysis";
import { generateCandidates, type PivotCandidate } from "./candidates";
import { checkImpulseRules, isTruncation } from "./rules";
import {
  alternationScore,
  wave2Score,
  wave3Score,
  wave4Score,
  wave5Score,
} from "./scoring";
import type {
  CountState,
  ElliottAnalysis,
  ElliottCountV2,
  FibScores,
  LabeledPivot,
  WaveLabel,
  WavePattern,
} from "./types";

const IMPULSE_LABELS: WaveLabel[] = ["0", "1", "2", "3", "4", "5"];

function labelImpulse(seq: PivotV2[]): LabeledPivot[] {
  return seq.slice(0, 6).map((p, i) => ({ pivot: p, label: IMPULSE_LABELS[i] }));
}

function detectPattern(seq: PivotV2[], direction: "long" | "short"): WavePattern {
  // If wave 4 overlaps wave 1, classify as diagonal (leading if early in trend, else ending).
  if (seq.length < 5) return "IMPULSE";
  const p1 = seq[1].price;
  const p4 = seq[4].price;
  const overlap = direction === "long" ? p4 <= p1 : p4 >= p1;
  if (!overlap) return "IMPULSE";
  // Heuristic: treat trailing position as ending diagonal.
  return "ENDING_DIAGONAL";
}

function evaluateCandidate(cand: PivotCandidate): ElliottCountV2 {
  const seq = cand.pivots;
  const direction = cand.direction;
  const pattern = detectPattern(seq, direction);

  const prices = seq.map((p) => p.price);
  const [p0, p1, p2, p3, p4, p5] = [prices[0], prices[1], prices[2], prices[3], prices[4], prices[5]];

  const rule = checkImpulseRules({
    direction,
    pattern,
    p0: p0!,
    p1: p1!,
    p2: p2!,
    p3,
    p4,
    p5,
  });

  const fibScores: FibScores = {
    wave2Retracement: p2 !== undefined ? wave2Score(p0, p1, p2) : null,
    wave3Extension: p3 !== undefined ? wave3Score(p0, p1, p2, p3) : null,
    wave4Retracement: p4 !== undefined ? wave4Score(p2, p3!, p4) : null,
    wave5Projection: p5 !== undefined ? wave5Score(p0, p1, p4!, p5) : null,
  };
  const alternation = p4 !== undefined ? alternationScore(p0, p1, p2, p3!, p4) : null;

  // Aggregate score: hard rules pass → start at 0.5, +soft components averaged.
  const softs = [fibScores.wave2Retracement, fibScores.wave3Extension, fibScores.wave4Retracement, fibScores.wave5Projection, alternation]
    .filter((v): v is number => v !== null);
  const softAvg = softs.length ? softs.reduce((a, b) => a + b, 0) / softs.length : 0;

  let state: CountState;
  let score: number;
  if (!rule.ok) {
    state = "INVALIDATED";
    score = 0;
  } else if (seq.length >= 6) {
    state = "COMPLETED";
    score = 0.5 + 0.5 * softAvg;
  } else if (seq.length >= 3) {
    state = "DEVELOPING";
    score = 0.3 + 0.4 * softAvg;
  } else {
    state = "NO_COUNT";
    score = 0;
  }

  const labeled = labelImpulse(seq);
  const currentWave = labeled.length ? labeled[labeled.length - 1].label : null;

  const notes: string[] = [];
  if (seq.length >= 6 && isTruncation({ direction, pattern, p0, p1, p2, p3, p4, p5 })) {
    notes.push("possible wave-5 truncation");
  }
  if (pattern !== "IMPULSE") notes.push(`pattern=${pattern} (overlap permitted)`);

  return {
    direction,
    pattern,
    state,
    labeled,
    currentWave,
    score: Math.max(0, Math.min(1, score)),
    fibScores,
    alternation,
    invalidations: rule.invalidations,
    notes,
  };
}

/**
 * Optional A-B-C corrective detection: takes pivots AFTER a completed impulse
 * and tries to label A/B/C against the corrective direction.
 */
export function detectCorrective(
  impulseEnd: PivotV2,
  after: ReadonlyArray<PivotV2>,
  impulseDirection: "long" | "short",
): ElliottCountV2 | null {
  if (after.length < 1) return null;
  // Corrective should move opposite to impulse direction.
  const correctiveDir: "long" | "short" = impulseDirection === "long" ? "short" : "long";
  const a = after[0];
  if (impulseDirection === "long" && a.price >= impulseEnd.price) return null;
  if (impulseDirection === "short" && a.price <= impulseEnd.price) return null;

  const labeled: LabeledPivot[] = [{ pivot: impulseEnd, label: "5" }, { pivot: a, label: "A" }];
  let pattern: WavePattern = "SIMPLE_CORRECTION";
  let state: CountState = "DEVELOPING";

  if (after.length >= 2) {
    const b = after[1];
    if (b.type === a.type) return null;
    // B must retrace but not exceed start (i.e. impulseEnd) for classic flat/zigzag.
    const exceeds = impulseDirection === "long" ? b.price > impulseEnd.price : b.price < impulseEnd.price;
    if (exceeds) return null;
    labeled.push({ pivot: b, label: "B" });

    if (after.length >= 3) {
      const cP = after[2];
      if (cP.type === b.type) return null;
      labeled.push({ pivot: cP, label: "C" });
      state = "COMPLETED";

      // Classify zigzag vs flat by B retracement of A.
      const aLen = Math.abs(a.price - impulseEnd.price);
      const bRetr = Math.abs(b.price - a.price) / aLen;
      pattern = bRetr < 0.7 ? "ZIGZAG" : "FLAT";
    }
  }

  // Proportionality A vs C score (soft).
  let score = 0.4;
  if (labeled.length === 4) {
    const aLen = Math.abs(a.price - impulseEnd.price);
    const cLen = Math.abs(after[2].price - after[1].price);
    const ratio = cLen / aLen;
    if (ratio > 0.618 && ratio < 1.618) score = 0.7;
  }

  return {
    direction: correctiveDir,
    pattern,
    state,
    labeled,
    currentWave: labeled[labeled.length - 1].label,
    score,
    fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
    alternation: null,
    invalidations: [],
    notes: [],
  };
}

export function analyzeElliott(pivots: ReadonlyArray<PivotV2>): ElliottAnalysis {
  // Prefer MAJOR pivots, fall back to all if insufficient.
  const major = pivots.filter((p) => p.strength === "MAJOR");
  const pool = major.length >= 4 ? major : pivots.slice();

  const cands = generateCandidates(pool);
  if (cands.length === 0) return { primary: null, alternatives: [] };

  const evaluated = cands
    .map(evaluateCandidate)
    .filter((c) => c.state !== "INVALIDATED" && c.state !== "NO_COUNT")
    .sort((a, b) => b.score - a.score);

  if (evaluated.length === 0) {
    // Surface the best invalidated one for diagnostics.
    const invalid = cands.map(evaluateCandidate).sort((a, b) => b.labeled.length - a.labeled.length)[0];
    return { primary: invalid ?? null, alternatives: [] };
  }

  const primary = evaluated[0];
  const alternatives = evaluated.slice(1, 4);

  // Try to attach a corrective A-B-C if the primary is completed and pivots remain after it.
  if (primary.state === "COMPLETED" && primary.labeled.length === 6) {
    const lastImpulseIdx = primary.labeled[5].pivot.index;
    const after = pool.filter((p) => p.index > lastImpulseIdx);
    const corrective = detectCorrective(primary.labeled[5].pivot, after, primary.direction);
    if (corrective) {
      // Append corrective labels onto the primary (skip the duplicated wave-5 anchor).
      primary.labeled = [...primary.labeled, ...corrective.labeled.slice(1)];
      primary.currentWave = corrective.currentWave;
      primary.pattern = corrective.pattern;
      primary.notes.push(`corrective ${corrective.pattern} attached`);
    }
  }

  return { primary, alternatives };
}