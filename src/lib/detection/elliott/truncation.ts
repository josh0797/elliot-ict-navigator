/**
 * Truncated-fifth evaluation.
 *
 * A truncated fifth is NOT "W5_PROJECTION failed". It is a specific,
 * evidence-bound classification: a valid 0-1-2-3-4-5 impulse whose wave 5
 * advanced in the direction of the impulse but failed to exceed the extreme of
 * wave 3, with five demonstrable internal subwaves inside wave 5, exhaustion /
 * reversal evidence, and an intact invalidation level.
 *
 * Without the internal subdivision the verdict is UNCONFIRMED, never
 * CONFIRMED — callers must keep the corrective (A-B-C) reading alive.
 */
import type { WaveLabel, WavePattern } from "./types";

export type TruncationVerdict = "CONFIRMED" | "UNCONFIRMED" | "NONE";

export interface TruncationCheck {
  code:
    | "SEQUENCE_COMPLETE"
    | "W3_NOT_SHORTEST"
    | "W4_NO_OVERLAP"
    | "W5_DIRECTIONAL"
    | "W5_BELOW_W3"
    | "FIVE_INTERNAL_SUBWAVES"
    | "EXHAUSTION_EVIDENCE"
    | "INVALIDATION_INTACT";
  passed: boolean;
  detail: string;
}

export interface TruncationEvidence {
  verdict: TruncationVerdict;
  wave3Extreme: number | null;
  wave5Extreme: number | null;
  /** |W3 extreme − W5 extreme| in price. */
  gapPrice: number | null;
  /** Same gap expressed in ATR units (null when no ATR is available). */
  gapAtr: number | null;
  /** Canonical internal labels found inside wave 5. */
  internalLabels: string[];
  internalSubwaves: number;
  exhaustion: string[];
  invalidationIntact: boolean;
  checks: TruncationCheck[];
  /** Human-readable reasons why the verdict is not CONFIRMED. */
  missing: string[];
}

export interface TruncationInput {
  direction: "long" | "short";
  pattern: WavePattern;
  p0?: number;
  p1?: number;
  p2?: number;
  p3?: number;
  p4?: number;
  p5?: number;
  /** Mandatory-rule invalidations produced by `checkImpulseRules`. */
  invalidations?: ReadonlyArray<string>;
  /** Labels of the lower-degree subdivision covering wave 5. */
  internalLabels?: ReadonlyArray<WaveLabel | string>;
  /** Exhaustion signal codes already collected for this count. */
  exhaustion?: ReadonlyArray<string>;
  /** True when price violated the count's invalidation level. */
  invalidationBreached?: boolean;
  /** ATR at the wave-5 pivot (for the price/ATR diagnostic). */
  atr?: number;
}

const IMPULSIVE_INTERNAL: string[] = ["1", "2", "3", "4", "5"];

export function evaluateTruncation(input: TruncationInput): TruncationEvidence {
  const { direction, pattern, p0, p1, p2, p3, p4, p5 } = input;
  const invs = (input.invalidations ?? []).join(" | ");
  const internalLabels = (input.internalLabels ?? []).map(String);
  const exhaustion = Array.from(new Set(input.exhaustion ?? []));
  const checks: TruncationCheck[] = [];
  const push = (code: TruncationCheck["code"], passed: boolean, detail: string) =>
    checks.push({ code, passed, detail });

  const complete = [p0, p1, p2, p3, p4, p5].every(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  push(
    "SEQUENCE_COMPLETE",
    complete,
    complete ? "0-1-2-3-4-5 present" : "incomplete impulse sequence",
  );

  const w3NotShortest = !/R2:/.test(invs);
  push(
    "W3_NOT_SHORTEST",
    w3NotShortest,
    w3NotShortest ? "wave 3 is not the shortest" : "wave 3 is the shortest of 1/3/5",
  );

  const noOverlap =
    !/R3:/.test(invs) || pattern === "ENDING_DIAGONAL" || pattern === "LEADING_DIAGONAL";
  push(
    "W4_NO_OVERLAP",
    noOverlap,
    noOverlap ? "wave 4 respects wave 1 (or valid diagonal)" : "wave 4 invades wave 1",
  );

  const advanced = complete && (direction === "long" ? p5! > p4! : p5! < p4!);
  push(
    "W5_DIRECTIONAL",
    advanced,
    advanced ? "wave 5 advances with the impulse" : "wave 5 does not advance from wave 4",
  );

  const belowThree = complete && (direction === "long" ? p5! < p3! : p5! > p3!);
  push(
    "W5_BELOW_W3",
    belowThree,
    belowThree ? "wave 5 failed to exceed wave 3" : "wave 5 exceeded wave 3 (no truncation)",
  );

  const subwaves = IMPULSIVE_INTERNAL.filter((l) => internalLabels.includes(l));
  const fiveSubwaves = subwaves.length === 5;
  push(
    "FIVE_INTERNAL_SUBWAVES",
    fiveSubwaves,
    `${subwaves.length}/5 internal subwaves inside wave 5${subwaves.length ? ` (${subwaves.join(",")})` : ""}`,
  );

  const hasExhaustion = exhaustion.length >= 1;
  push(
    "EXHAUSTION_EVIDENCE",
    hasExhaustion,
    hasExhaustion ? exhaustion.join(", ") : "no exhaustion / reversal evidence",
  );

  const invalidationIntact = input.invalidationBreached !== true;
  push(
    "INVALIDATION_INTACT",
    invalidationIntact,
    invalidationIntact ? "invalidation level intact" : "invalidation level breached",
  );

  const geometry = complete && advanced && belowThree && w3NotShortest && noOverlap;
  const gapPrice = complete ? Math.abs(p3! - p5!) : null;
  const atr = input.atr;
  const gapAtr =
    gapPrice !== null && typeof atr === "number" && Number.isFinite(atr) && atr > 0
      ? gapPrice / atr
      : null;

  let verdict: TruncationVerdict = "NONE";
  if (geometry) {
    verdict = fiveSubwaves && hasExhaustion && invalidationIntact ? "CONFIRMED" : "UNCONFIRMED";
  }

  return {
    verdict,
    wave3Extreme: complete ? p3! : null,
    wave5Extreme: complete ? p5! : null,
    gapPrice,
    gapAtr,
    internalLabels,
    internalSubwaves: subwaves.length,
    exhaustion,
    invalidationIntact,
    checks,
    missing: checks.filter((c) => !c.passed).map((c) => `${c.code}: ${c.detail}`),
  };
}
