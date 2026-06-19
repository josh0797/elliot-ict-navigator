/**
 * Soft scoring for an Elliott impulse: Fib proportionality + W2/W4 alternation.
 * All scores in [0, 1].
 */

const W2_RATIOS = [0.382, 0.5, 0.618, 0.786];
const W3_RATIOS = [1.0, 1.618, 2.618];
const W4_RATIOS = [0.236, 0.382, 0.5];
const W5_RATIOS = [0.618, 1.0, 1.618];

/** Returns 1 when `ratio` matches any target within tolerance, decays linearly to 0 outside. */
export function fibProximity(ratio: number, targets: number[], tolerance = 0.08): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  let best = 0;
  for (const t of targets) {
    const d = Math.abs(ratio - t) / t;
    const score = Math.max(0, 1 - d / tolerance);
    if (score > best) best = score;
  }
  return best;
}

export function wave2Score(p0: number, p1: number, p2: number): number {
  const w1 = Math.abs(p1 - p0);
  const retr = Math.abs(p1 - p2);
  return fibProximity(retr / w1, W2_RATIOS);
}

export function wave3Score(p0: number, p1: number, p2: number, p3: number): number {
  const w1 = Math.abs(p1 - p0);
  const w3 = Math.abs(p3 - p2);
  return fibProximity(w3 / w1, W3_RATIOS, 0.15);
}

export function wave4Score(p2: number, p3: number, p4: number): number {
  const w3 = Math.abs(p3 - p2);
  const retr = Math.abs(p3 - p4);
  return fibProximity(retr / w3, W4_RATIOS);
}

export function wave5Score(p0: number, p1: number, p4: number, p5: number): number {
  const w1 = Math.abs(p1 - p0);
  const w5 = Math.abs(p5 - p4);
  return fibProximity(w5 / w1, W5_RATIOS, 0.12);
}

/** Alternation score: 1 if W2 and W4 differ in depth (ratio > 1.5 or < 0.66). */
export function alternationScore(p0: number, p1: number, p2: number, p3: number, p4: number): number {
  const w1 = Math.abs(p1 - p0);
  const w3 = Math.abs(p3 - p2);
  const w2Depth = Math.abs(p1 - p2) / w1;
  const w4Depth = Math.abs(p3 - p4) / w3;
  if (w2Depth === 0 || w4Depth === 0) return 0;
  const r = w2Depth / w4Depth;
  if (r > 1.5 || r < 1 / 1.5) return 1;
  return Math.max(0, (Math.abs(r - 1) - 0.1) / 0.4);
}