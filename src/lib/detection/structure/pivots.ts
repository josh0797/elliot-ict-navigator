/**
 * Pivot detection via left/right fractals with ATR-based minimum distance.
 * No look-ahead: the last `rightBars` candles cannot host a confirmed pivot.
 * Same-type consecutive pivots are deduplicated keeping the most extreme one.
 */

import { atr14 } from "../indicators/atr";
import type { CandleV2, PivotV2, PivotStrength } from "../schemas/analysis";

export interface PivotOptions {
  /** Bars to the left required to qualify a fractal. Default 3. */
  leftBars?: number;
  /** Bars to the right required to confirm a fractal. Default 3. */
  rightBars?: number;
  /** Minimum distance between consecutive pivots, expressed as multiples of ATR14. Default 0.75. */
  minAtrDistance?: number;
  /** Threshold (in ATR multiples) above which a pivot is tagged MAJOR. Default 2.0. */
  majorAtrThreshold?: number;
}

const ID = (time: number, type: "HIGH" | "LOW") => `${time}-${type}`;

/**
 * Resolve ATR at or before `index`, skipping NaN/<=0 values.
 * Returns `null` when ATR has not warmed up yet (first ~14 bars) — callers
 * MUST treat this as "no reliable scale" rather than substituting an
 * epsilon, which would inflate distance ratios and mis-classify early
 * pivots as MAJOR.
 */
function resolveAtr(atrSeries: ReadonlyArray<number>, index: number): number | null {
  for (let i = Math.min(index, atrSeries.length - 1); i >= 0; i--) {
    const v = atrSeries[i];
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Collapse consecutive same-type pivots, keeping the more extreme one.
 * Applied both right after fractal detection AND after the ATR-distance
 * filter, because removing intermediate pivots can leave two same-type
 * pivots adjacent (e.g. LOW, HIGH-dropped, LOW → LOW, LOW).
 */
function dedupeAlternating(pivots: ReadonlyArray<PivotV2>): PivotV2[] {
  const out: PivotV2[] = [];
  for (const p of pivots) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(p); continue; }
    if (prev.type === p.type) {
      const keepNew = p.type === "HIGH" ? p.price > prev.price : p.price < prev.price;
      if (keepNew) out[out.length - 1] = { ...p, confirmed: prev.confirmed && p.confirmed };
      continue;
    }
    out.push(p);
  }
  return out;
}

function pivotPrice(c: CandleV2, type: "HIGH" | "LOW"): number {
  return type === "HIGH" ? c.high : c.low;
}

function isFractal(
  candles: ReadonlyArray<CandleV2>,
  i: number,
  type: "HIGH" | "LOW",
  left: number,
  right: number,
): boolean {
  if (i - left < 0 || i + right >= candles.length) return false;
  const ref = pivotPrice(candles[i], type);
  for (let k = i - left; k <= i + right; k++) {
    if (k === i) continue;
    const p = pivotPrice(candles[k], type);
    if (type === "HIGH" ? p > ref : p < ref) return false;
  }
  return true;
}

/**
 * Returns ALL pivots — last one may be `confirmed: false` (provisional)
 * when it lacks the required `rightBars` to the right.
 */
export function detectPivots(
  candles: ReadonlyArray<CandleV2>,
  opts: PivotOptions = {},
): PivotV2[] {
  const leftBars = opts.leftBars ?? 3;
  const rightBars = opts.rightBars ?? 3;
  const minAtr = opts.minAtrDistance ?? 0.75;
  const majorAtr = opts.majorAtrThreshold ?? 2.0;

  if (candles.length < leftBars + rightBars + 1) return [];

  const atrSeries = atr14(candles);
  const raw: PivotV2[] = [];

  // Confirmed fractals.
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const c = candles[i];
    for (const type of ["HIGH", "LOW"] as const) {
      if (!isFractal(candles, i, type, leftBars, rightBars)) continue;
      const price = pivotPrice(c, type);
      raw.push({
        id: ID(c.time, type),
        index: i,
        time: c.time,
        price,
        type,
        strength: "MINOR",
        atrDistance: 0,
        confirmed: true,
      });
    }
  }

  // Add a provisional tail pivot from the most recent candles if it would be
  // a fractal looking only to the left (no right bars yet).
  const lastIdx = candles.length - 1;
  for (let i = lastIdx; i >= Math.max(leftBars, lastIdx - rightBars); i--) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let k = i - leftBars; k < i; k++) {
      if (candles[k].high >= c.high) isHigh = false;
      if (candles[k].low <= c.low) isLow = false;
    }
    for (let k = i + 1; k <= lastIdx; k++) {
      if (candles[k].high >= c.high) isHigh = false;
      if (candles[k].low <= c.low) isLow = false;
    }
    if (isHigh) {
      raw.push({ id: ID(c.time, "HIGH"), index: i, time: c.time, price: c.high, type: "HIGH", strength: "MINOR", atrDistance: 0, confirmed: false });
      break;
    }
    if (isLow) {
      raw.push({ id: ID(c.time, "LOW"), index: i, time: c.time, price: c.low, type: "LOW", strength: "MINOR", atrDistance: 0, confirmed: false });
      break;
    }
  }

  // Sort by index (ties: HIGH before LOW is arbitrary; dedup handles it).
  raw.sort((a, b) => a.index - b.index || (a.type === b.type ? 0 : a.type === "HIGH" ? -1 : 1));

  // Dedup same-type consecutive pivots, keep most extreme.
  const dedup = dedupeAlternating(raw);

  // Enforce ATR distance threshold + tag strength.
  const filtered: PivotV2[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const p = dedup[i];
    const prev = filtered[filtered.length - 1];
    const a = resolveAtr(atrSeries, p.index);
    if (!prev) {
      filtered.push({ ...p, atrDistance: 0, strength: "MINOR" });
      continue;
    }
    if (a === null) {
      // ATR not warmed up — accept the pivot but never promote to MAJOR
      // and skip the ATR-distance gate to avoid epsilon-induced inflation.
      filtered.push({ ...p, atrDistance: 0, strength: "MINOR" });
      continue;
    }
    const dist = Math.abs(p.price - prev.price) / a;
    if (dist < minAtr) continue;
    const strength: PivotStrength = dist >= majorAtr ? "MAJOR" : "MINOR";
    filtered.push({ ...p, atrDistance: dist, strength });
  }

  // ATR filter can drop intermediate pivots and leave same-type neighbours
  // (LOW, HIGH-dropped, LOW). Re-dedup so downstream Elliott/ICT receive a
 // strictly alternating sequence.
  return dedupeAlternating(filtered);
}

export function majorPivots(pivots: ReadonlyArray<PivotV2>): PivotV2[] {
  return pivots.filter((p) => p.strength === "MAJOR");
}

export function isLastProvisional(pivots: ReadonlyArray<PivotV2>): boolean {
  return pivots.length > 0 && !pivots[pivots.length - 1].confirmed;
}