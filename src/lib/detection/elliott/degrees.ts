/**
 * Elliott degree separation.
 *
 * The count horizon used to be "the last 15 pivots", which anchored every
 * count to the live edge and produced very short counts on 500/1000/2000-bar
 * datasets. Degrees fix this: pivots are ranked by structural *importance*
 * (ATR-normalised leg size, percentage move and time duration) and each
 * degree keeps a different sensitivity:
 *
 *   macroDeviation > intermediateDeviation > minorDeviation
 *
 * MAJOR therefore spans the whole loaded history, while MINOR describes the
 * most recent internal subdivisions.
 */

import type { PivotV2 } from "../schemas/analysis";

export type ElliottDegree = "MAJOR" | "INTERMEDIATE" | "MINOR";

export const DEGREES: ElliottDegree[] = ["MAJOR", "INTERMEDIATE", "MINOR"];

/** Max pivots kept per degree (higher degree = fewer, larger swings). */
const POOL_SIZE: Record<ElliottDegree, number> = {
  MAJOR: 11,
  INTERMEDIATE: 17,
  MINOR: 26,
};

/** Minimum importance a pivot needs to belong to the degree pool. */
const MIN_IMPORTANCE: Record<ElliottDegree, number> = {
  MAJOR: 0.42,
  INTERMEDIATE: 0.22,
  MINOR: 0,
};

export interface ScoredPivot {
  pivot: PivotV2;
  importance: number;
}

/**
 * Importance of a pivot = size of the largest leg it terminates or starts,
 * blended with its time duration and percentage travel. Range 0..1.
 */
export function scorePivots(pivots: ReadonlyArray<PivotV2>): ScoredPivot[] {
  return pivots.map((p, i) => {
    const prev = pivots[i - 1];
    const next = pivots[i + 1];
    const legPrevAtr = p.atrDistance;
    const legNextAtr = next ? next.atrDistance : legPrevAtr;
    const legAtr = Math.max(legPrevAtr, legNextAtr);

    const refPrice = Math.abs(p.price) || 1;
    const pctPrev = prev ? Math.abs(p.price - prev.price) / refPrice : 0;
    const pctNext = next ? Math.abs(next.price - p.price) / refPrice : 0;
    const pct = Math.max(pctPrev, pctNext);

    const barsPrev = prev ? p.index - prev.index : 0;
    const barsNext = next ? next.index - p.index : barsPrev;
    const bars = Math.max(barsPrev, barsNext);

    const importance =
      0.6 * Math.min(1, legAtr / 4) +
      0.25 * Math.min(1, bars / 40) +
      0.15 * Math.min(1, pct / 0.05);

    return { pivot: p, importance };
  });
}

function dedupeAlternating(pivots: ReadonlyArray<PivotV2>): PivotV2[] {
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

/**
 * Build the pivot pool for one degree over the FULL dataset (no `.slice(-N)`
 * recency window). The most recent pivot is always kept so the live edge of
 * the market is represented.
 */
export function degreePool(pivots: ReadonlyArray<PivotV2>, degree: ElliottDegree): PivotV2[] {
  if (pivots.length === 0) return [];
  const scored = scorePivots(pivots);
  const last = pivots[pivots.length - 1];

  let threshold = MIN_IMPORTANCE[degree];
  let selected: ScoredPivot[] = [];
  // Relax the deviation requirement until we have enough structure to count.
  for (let attempt = 0; attempt < 6; attempt++) {
    selected = scored.filter((s) => s.importance >= threshold);
    if (selected.length >= 6) break;
    threshold *= 0.6;
  }
  if (selected.length < 3) selected = scored.slice();

  const cap = POOL_SIZE[degree];
  if (selected.length > cap) {
    const top = [...selected].sort((a, b) => b.importance - a.importance).slice(0, cap);
    const ids = new Set(top.map((s) => s.pivot.id));
    ids.add(last.id);
    selected = selected.filter((s) => ids.has(s.pivot.id));
  }

  const chronological = selected
    .map((s) => s.pivot)
    .sort((a, b) => a.index - b.index);
  if (!chronological.some((p) => p.id === last.id)) chronological.push(last);
  return dedupeAlternating(chronological);
}

/** Auto degree from the analysed timeframe (Regla crítica: degree ~ swing size). */
export function autoDegree(timeframe: string | undefined): ElliottDegree {
  switch ((timeframe ?? "1h").toLowerCase()) {
    case "1m": case "1min": case "5m": case "5min": case "15m": case "15min":
      return "MINOR";
    case "30m": case "30min": case "1h": case "1hour":
      return "INTERMEDIATE";
    case "4h": case "4hour":
      return "INTERMEDIATE";
    case "1d": case "1day": case "1w": case "1week":
      return "MAJOR";
    default:
      return "INTERMEDIATE";
  }
}

/** Degree immediately below `degree` (used for internal subdivisions). */
export function lowerDegree(degree: ElliottDegree): ElliottDegree | null {
  if (degree === "MAJOR") return "INTERMEDIATE";
  if (degree === "INTERMEDIATE") return "MINOR";
  return null;
}