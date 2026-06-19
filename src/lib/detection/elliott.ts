import type { ElliottCount, Pivot, WaveLabel } from "./types";

/**
 * @deprecated Phase-1/2 introduced `src/lib/detection/elliott/engine.ts` with
 * full candidate generation, A-B-C, diagonals and Fib scoring. This file is
 * kept temporarily to keep `engine.ts` (legacy) building; it will be removed
 * when the new pipeline is wired into the setup builder.
 *
 * Attempts to label the last 6 pivots as an Elliott 1-2-3-4-5 impulse
 * (followed optionally by A-B-C). Applies the three classic rules.
 */
export function countElliott(pivots: Pivot[]): ElliottCount {
  if (pivots.length < 6) {
    return invalid(pivots, "Insuficientes pivotes");
  }
  const last = pivots.slice(-9); // up to 5 impulsive + ABC
  // Need alternating H/L
  for (let i = 1; i < last.length; i++) {
    if (last[i].type === last[i - 1].type) return invalid(pivots, "Pivotes no alternantes");
  }

  // We try to label the latest 6 as P0,1,2,3,4,5 ending after wave 5
  // or the latest 5 as P0,1,2,3,4 (currently inside wave 4 -> looking for entry)
  const six = last.slice(-6);
  const direction: "long" | "short" = six[1].price > six[0].price ? "long" : "short";

  const W1 = Math.abs(six[1].price - six[0].price);
  const W2 = Math.abs(six[2].price - six[1].price);
  const W3 = Math.abs(six[3].price - six[2].price);
  const W4 = Math.abs(six[4].price - six[3].price);
  const W5 = Math.abs(six[5].price - six[4].price);

  // Rule 1: Wave 2 cannot retrace > 100% of wave 1
  if (W2 >= W1) return invalid(pivots, "Onda 2 retrocede >100% de la 1");
  // Rule 2: Wave 3 is never the shortest impulsive wave
  if (W3 < W1 && W3 < W5) return invalid(pivots, "Onda 3 es la más corta");
  // Rule 3: Wave 4 cannot overlap wave 1 territory
  if (direction === "long" && six[4].price <= six[1].price)
    return invalid(pivots, "Onda 4 solapa onda 1");
  if (direction === "short" && six[4].price >= six[1].price)
    return invalid(pivots, "Onda 4 solapa onda 1");

  void W4; // included for completeness; no rule strictly uses it

  // Determine the current wave label based on most recent pivot
  // If last 6 form 0,1,2,3,4,5 then wave 5 just printed; if last 5 → wave 4 ended
  const labels: WaveLabel[] = ["1", "2", "3", "4", "5"];
  // align labels with six[1..5]
  return {
    pivots: six,
    labels,
    direction,
    degree: "intermediate",
    currentWave: labels[labels.length - 1],
    valid: true,
  };
}

function invalid(pivots: Pivot[], reason: string): ElliottCount {
  return {
    pivots: pivots.slice(-6),
    labels: [],
    direction: "long",
    degree: "intermediate",
    currentWave: null,
    valid: false,
    reason,
  };
}