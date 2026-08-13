/**
 * Split the directional vote mass into an Elliott score and an ICT score so
 * the final bias is always explainable — and never silently imposes one side
 * when the two models disagree.
 */
import type { DirectionBiasResult, DirectionVote, VoteDirection } from "./types";

export type FinalBias = VoteDirection | "MIXED";

export interface BiasSplit {
  /** Signed score: positive = bullish, negative = bearish. */
  elliottScore: number;
  ictScore: number;
  elliottBias: VoteDirection;
  ictBias: VoteDirection;
  finalBias: FinalBias;
  /** True when Elliott and ICT point to opposite sides with meaningful mass. */
  conflict: boolean;
  explanation: string;
}

/** Minimum absolute score per side for a disagreement to count as conflict. */
const MIN_CONFLICT_MASS = 1.5;

function isElliott(v: DirectionVote): boolean {
  return v.source.startsWith("ELLIOTT");
}

function signed(votes: ReadonlyArray<DirectionVote>): number {
  let s = 0;
  for (const v of votes) {
    if (v.direction === "BULLISH") s += v.weight;
    else if (v.direction === "BEARISH") s -= v.weight;
  }
  return Math.round(s * 100) / 100;
}

function biasOf(score: number): VoteDirection {
  if (score > 0) return "BULLISH";
  if (score < 0) return "BEARISH";
  return "NEUTRAL";
}

export function computeBiasSplit(bias: DirectionBiasResult): BiasSplit {
  const elliottScore = signed(bias.votes.filter(isElliott));
  const ictScore = signed(bias.votes.filter((v) => !isElliott(v)));
  const elliottBias = biasOf(elliottScore);
  const ictBias = biasOf(ictScore);

  const conflict =
    elliottBias !== "NEUTRAL" &&
    ictBias !== "NEUTRAL" &&
    elliottBias !== ictBias &&
    Math.abs(elliottScore) >= MIN_CONFLICT_MASS &&
    Math.abs(ictScore) >= MIN_CONFLICT_MASS;

  let finalBias: FinalBias;
  if (conflict) finalBias = "MIXED";
  else if (elliottBias === ictBias) finalBias = elliottBias;
  else finalBias = elliottBias !== "NEUTRAL" ? elliottBias : ictBias;

  const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  const explanation = conflict
    ? `WAIT — Elliott and ICT are not aligned (Elliott ${fmt(elliottScore)} ${elliottBias} vs ICT ${fmt(ictScore)} ${ictBias}).`
    : `Elliott ${fmt(elliottScore)} ${elliottBias} · ICT ${fmt(ictScore)} ${ictBias} → ${finalBias}`;

  return { elliottScore, ictScore, elliottBias, ictBias, finalBias, conflict, explanation };
}
