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

  // ── Complex corrections (W-X-Y / W-X-Y-X-Z) ───────────────────────────────
  // Four or more alternating corrective pivots cannot be a single zigzag/flat:
  // label them as a double (W-X-Y) or triple (W-X-Y-X-Z) combination.
  const alternating = (): PivotV2[] => {
    const seq: PivotV2[] = [a];
    for (let i = 1; i < after.length; i++) {
      if (after[i].type === seq[seq.length - 1].type) break;
      seq.push(after[i]);
    }
    return seq;
  };
  const seq = alternating();
  if (seq.length >= 4) {
    const COMPLEX: WaveLabel[] = ["W", "X", "Y", "X", "Z"];
    const used = seq.slice(0, 5);
    const complexLabeled: LabeledPivot[] = [
      { pivot: impulseEnd, label: "5" },
      ...used.map((p, i) => ({ pivot: p, label: COMPLEX[i] })),
    ];
    const isTriple = used.length >= 5;
    return {
      direction: correctiveDir,
      pattern: isTriple ? "TRIPLE_ZIGZAG" : "DOUBLE_ZIGZAG",
      state: isTriple ? "COMPLETED" : "DEVELOPING",
      labeled: complexLabeled,
      currentWave: complexLabeled[complexLabeled.length - 1].label,
      score: isTriple ? 0.6 : 0.5,
      fibScores: { wave2Retracement: null, wave3Extension: null, wave4Retracement: null, wave5Projection: null },
      alternation: null,
      invalidations: [],
      notes: [isTriple ? "triple combination W-X-Y-X-Z" : "double zigzag W-X-Y"],
    };
  }

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
  const pool = selectElliottPool(pivots);

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

  // Wave-4 discipline: a wave 4 is only "done" while price has not violated it
  // again. If pivots after the labeled wave 5 push beyond wave 4 against the
  // trend, wave 5 never happened — the correction labeled 4 is still unfolding
  // as a complex W-X-Y structure from wave 3.
  enforceWave4Discipline(primary, pool);

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

function enforceWave4Discipline(count: ElliottCountV2, pool: ReadonlyArray<PivotV2>): void {
  const four = count.labeled.find((l) => l.label === "4");
  const five = count.labeled.find((l) => l.label === "5");
  const three = count.labeled.find((l) => l.label === "3");
  if (!four || !five || !three) return;

  const violated = pool.some((p) =>
    p.index > five.pivot.index &&
    (count.direction === "long" ? p.price < four.pivot.price : p.price > four.pivot.price),
  );
  if (!violated) return;

  // Re-label: keep 0-1-2-3 and treat everything after wave 3 as a developing
  // complex correction (wave 4 in progress).
  const afterThree = pool.filter((p) => p.index > three.pivot.index);
  const COMPLEX: WaveLabel[] = ["W", "X", "Y", "X", "Z"];
  const corrective: LabeledPivot[] = [];
  for (let i = 0; i < afterThree.length && i < COMPLEX.length; i++) {
    const prev = corrective[corrective.length - 1]?.pivot ?? three.pivot;
    if (afterThree[i].type === prev.type) break;
    corrective.push({ pivot: afterThree[i], label: COMPLEX[i] });
  }
  count.labeled = [...count.labeled.filter((l) => ["0", "1", "2", "3"].includes(l.label)), ...corrective];
  count.currentWave = corrective.length ? corrective[corrective.length - 1].label : "3";
  count.state = "DEVELOPING";
  count.pattern = corrective.length >= 3 ? "DOUBLE_ZIGZAG" : "SIMPLE_CORRECTION";
  count.score = Math.min(count.score, 0.55);
  count.notes.push("wave 4 still unfolding (price re-entered wave-4 territory) → labeled as W-X-Y");
}

/**
 * Pool selection for macro counts.
 *
 * 1. Prefer MAJOR pivots; fall back to ALL pivots if fewer than 4 majors.
 * 2. When the pool is large (long HTF windows on trending markets), the
 *    candidate generator saturates on noisy MINOR-like sequences and often
 *    returns short DEVELOPING counts (0-1-2) that outrank longer completed
 *    impulses. Cap the working pool to the `MAX_POOL_SIZE` most prominent
 *    pivots by ATR distance, keeping the most recent pivot always so the
 *    live edge of the market is never dropped, then re-enforce type
 *    alternation after the filter.
 */
/**
 * Recency-based cap: the count is anchored at the live edge, so preserve the
 * last `MAX_POOL_SIZE` pivots. Older prominent swings do not help — they
 * add candidates that spuriously outrank the current impulse.
 */
const MAX_POOL_SIZE = 15;

function selectElliottPool(pivots: ReadonlyArray<PivotV2>): PivotV2[] {
  const major = pivots.filter((p) => p.strength === "MAJOR");
  const base: PivotV2[] = major.length >= 4 ? major.slice() : pivots.slice();
  if (base.length <= MAX_POOL_SIZE) return base;
  const tail = base.slice(base.length - MAX_POOL_SIZE);
  return dedupeAlt(tail);
}

function dedupeAlt(pivots: PivotV2[]): PivotV2[] {
  const out: PivotV2[] = [];
  for (const p of pivots) {
    const prev = out[out.length - 1];
    if (prev && prev.type === p.type) {
      const keepNew = p.type === "HIGH" ? p.price > prev.price : p.price < prev.price;
      if (keepNew) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}