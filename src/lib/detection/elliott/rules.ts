import type { WavePattern } from "./types";

/**
 * Hard rules 1-3 for an Elliott impulse.
 * Inputs are prices at pivots P0..P5 (last index may be undefined for
 * developing counts). Direction is derived from P0->P1.
 */
export interface ImpulseInput {
  direction: "long" | "short";
  pattern: WavePattern;            // IMPULSE | LEADING_DIAGONAL | ENDING_DIAGONAL
  p0: number;
  p1: number;
  p2: number;
  p3?: number;
  p4?: number;
  p5?: number;
}

export interface RuleResult {
  ok: boolean;
  invalidations: string[];
}

const lt = (a: number, b: number) => a < b;
const gt = (a: number, b: number) => a > b;

export function checkImpulseRules(input: ImpulseInput): RuleResult {
  const inv: string[] = [];
  const dir = input.direction;
  const lower = dir === "long" ? lt : gt; // "below" relation
  const upper = dir === "long" ? gt : lt; // "above" relation

  // Rule 1: Wave 2 cannot retrace past origin of wave 1.
  // i.e. p2 must stay above p0 in a bullish impulse, below in bearish.
  if (lower(input.p2, input.p0) || input.p2 === input.p0) {
    inv.push("R1: wave 2 retraced 100% of wave 1 (past P0)");
  }

  // Rule 2: Wave 3 is never the shortest among 1, 3, 5 (when 5 exists).
  if (input.p3 !== undefined) {
    const w1 = Math.abs(input.p1 - input.p0);
    const w3 = Math.abs(input.p3 - input.p2);
    if (input.p5 !== undefined && input.p4 !== undefined) {
      const w5 = Math.abs(input.p5 - input.p4);
      if (w3 < w1 && w3 < w5) {
        inv.push("R2: wave 3 is the shortest among 1/3/5");
      }
    } else {
      // Developing: only need w3 not absurdly short vs w1.
      if (w3 < w1 * 0.5) inv.push("R2 (soft): wave 3 < 0.5 * wave 1");
    }
  }

  // Rule 3: Wave 4 cannot enter wave 1 territory in a standard impulse.
  // For diagonals (leading/ending), overlap is permitted.
  if (input.p4 !== undefined) {
    const overlaps = dir === "long" ? input.p4 <= input.p1 : input.p4 >= input.p1;
    if (overlaps && input.pattern === "IMPULSE") {
      inv.push("R3: wave 4 overlaps wave 1 territory (impulse)");
    }
  }

  // Implicit checks: P3 must extend beyond P1; P5 normally beyond P3 (unless truncation).
  if (input.p3 !== undefined && upper(input.p1, input.p3)) {
    // p3 did not surpass p1 → not an impulse at all.
    inv.push("IMP: wave 3 did not surpass wave 1");
  }

  return { ok: inv.length === 0, invalidations: inv };
}

/** Truncation check: returns true if wave 5 failed to break wave 3. */
export function isTruncation(input: ImpulseInput): boolean {
  if (input.p3 === undefined || input.p5 === undefined) return false;
  return input.direction === "long" ? input.p5 < input.p3 : input.p5 > input.p3;
}