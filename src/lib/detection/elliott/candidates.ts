import type { PivotV2 } from "../schemas/analysis";

/**
 * A candidate is an ordered sub-sequence of pivots with strictly alternating
 * type. We allow partial sequences (3..9 pivots) so DEVELOPING counts can be
 * scored. The pivot at index 0 is the impulse origin (`P0`).
 */
export interface PivotCandidate {
  pivots: PivotV2[];
  direction: "long" | "short";
}

/** Take the last N alternating-type pivots ending at `pivots[end]` (inclusive). */
function takeAlternatingFrom(pivots: ReadonlyArray<PivotV2>, end: number, max: number): PivotV2[] {
  const out: PivotV2[] = [pivots[end]];
  for (let i = end - 1; i >= 0 && out.length < max; i--) {
    if (pivots[i].type !== out[0].type) {
      out.unshift(pivots[i]);
    } else {
      break;
    }
  }
  return out;
}

/**
 * Generate multiple candidate sub-sequences ending at or near the most recent
 * pivot. We try several end indices (the last few pivots) and several lengths
 * so the engine can score them all.
 */
export function generateCandidates(pivots: ReadonlyArray<PivotV2>): PivotCandidate[] {
  const out: PivotCandidate[] = [];
  if (pivots.length < 3) return out;

  const ends = [pivots.length - 1, pivots.length - 2, pivots.length - 3]
    .filter((i) => i >= 2);

  for (const end of ends) {
    for (const max of [9, 8, 7, 6, 5, 4, 3]) {
      const seq = takeAlternatingFrom(pivots, end, max);
      if (seq.length < 3) continue;
      const dir: "long" | "short" = seq[1].price > seq[0].price ? "long" : "short";
      // Reject sequences whose direction contradicts the leg P0->P1.
      // (Already implicit; kept for clarity.)
      out.push({ pivots: seq, direction: dir });
    }
  }
  // Dedup by signature (start index + length + direction).
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.pivots[0].index}:${c.pivots.length}:${c.direction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}