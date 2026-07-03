import type { ElliottAnalysis } from "../elliott/types";
import type { IctContext } from "../ict/types";
import type { DirectionBiasResult, DirectionVote, VoteDirection } from "./types";

const RECENT_BARS = 10;
/**
 * Relative conflict tolerance: NEUTRAL is only declared when the winning
 * side leads by less than `CONFLICT_TOLERANCE_REL` of the total vote mass.
 * This keeps 4.0/4.5 (real tie) neutral while letting 10.0/11.0 resolve
 * cleanly.
 */
const CONFLICT_TOLERANCE_REL = 0.15;
/** Minimum score required to fall back to a Elliott alternative count. */
const MIN_ALTERNATIVE_SCORE = 0.4;

function dirFromBias(b: "BULLISH" | "BEARISH" | "NEUTRAL"): VoteDirection {
  return b;
}

export function computeDirectionBias(
  elliott: ElliottAnalysis,
  ict: IctContext,
  candleCount: number,
): DirectionBiasResult {
  const votes: DirectionVote[] = [];

  // 1. Elliott primary bias
  const primary = elliott.primary;
  if (primary && primary.state !== "INVALIDATED") {
    votes.push({
      source: "ELLIOTT_PRIMARY",
      direction: primary.direction === "long" ? "BULLISH" : "BEARISH",
      weight: 2.0,
      reason: `Primary count ${primary.pattern} ${primary.direction} (W${primary.currentWave ?? "?"})`,
    });

    // 2. Wave context — impulse waves 3/5 reinforce, corrective 2/4/B count too
    if (primary.currentWave) {
      const trending = ["1", "3", "5"].includes(primary.currentWave);
      const corrective = ["2", "4", "B"].includes(primary.currentWave);
      if (trending || corrective) {
        votes.push({
          source: "ELLIOTT_WAVE",
          direction: primary.direction === "long" ? "BULLISH" : "BEARISH",
          weight: trending ? 1.2 : 0.8,
          reason: `Current wave ${primary.currentWave} aligned with primary direction`,
        });
      }
    }
  } else {
    // Fall back to an alternative ONLY when it is valid AND has enough score.
    // The first item is not implicitly trusted — alternatives can themselves
    // be INVALIDATED or low-quality (the engine surfaces best-effort counts
    // for diagnostics).
    const validAlternative = elliott.alternatives
      .filter((alt) => alt.state !== "INVALIDATED" && alt.state !== "NO_COUNT")
      .filter((alt) => alt.score >= MIN_ALTERNATIVE_SCORE)
      .sort((a, b) => b.score - a.score)[0];
    if (validAlternative) {
      votes.push({
        source: "ELLIOTT_ALTERNATIVE",
        direction: validAlternative.direction === "long" ? "BULLISH" : "BEARISH",
        weight: 1.0,
        reason: `Primary invalidated — using alternative ${validAlternative.pattern} (score ${(validAlternative.score * 100).toFixed(0)})`,
      });
    }
  }

  // 3. ICT market structure bias
  if (ict.bias !== "NEUTRAL") {
    votes.push({
      source: "ICT_STRUCTURE",
      direction: dirFromBias(ict.bias),
      weight: 2.0,
      reason: `Market structure ${ict.bias}`,
    });
  }

  // 4./5. Last confirmed BOS / CHoCH
  const confirmed = ict.structure.filter((e) => e.state === "CONFIRMED");
  const lastBos = [...confirmed].reverse().find((e) => e.type === "BOS");
  const lastChoch = [...confirmed].reverse().find((e) => e.type === "CHoCH");
  if (lastChoch) {
    votes.push({
      source: "ICT_CHOCH",
      direction: lastChoch.direction === "long" ? "BULLISH" : "BEARISH",
      weight: 2.0,
      reason: `Last CHoCH ${lastChoch.direction}`,
    });
  }
  if (lastBos) {
    votes.push({
      source: "ICT_BOS",
      direction: lastBos.direction === "long" ? "BULLISH" : "BEARISH",
      weight: 1.5,
      reason: `Last BOS ${lastBos.direction}`,
    });
  }

  // 6. Recent sweep — only a *complete* stop-hunt counts (wick beyond AND
  // close back inside). A wick-only event can be a breakout in disguise and
  // must NOT inject a reversal vote.
  const cutoff = candleCount - RECENT_BARS;
  const sweep = [...ict.sweeps]
    .reverse()
    .find((s) => s.index >= cutoff && s.wickBeyond && s.closeBack);
  if (sweep) {
    votes.push({
      source: "ICT_SWEEP",
      direction: sweep.type === "sell_side" ? "BULLISH" : "BEARISH",
      weight: 1.5,
      reason: `${sweep.type === "sell_side" ? "SSL" : "BSL"} sweep with close-back`,
    });
  }

  // 7. Premium/Discount
  if (ict.pdArray) {
    if (ict.pdArray.zone === "PREMIUM") {
      votes.push({ source: "PD_ARRAY", direction: "BEARISH", weight: 1.0, reason: "Price in PREMIUM" });
    } else if (ict.pdArray.zone === "DISCOUNT") {
      votes.push({ source: "PD_ARRAY", direction: "BULLISH", weight: 1.0, reason: "Price in DISCOUNT" });
    }
  }

  let bullScore = 0;
  let bearScore = 0;
  for (const v of votes) {
    if (v.direction === "BULLISH") bullScore += v.weight;
    else if (v.direction === "BEARISH") bearScore += v.weight;
  }

  let dominant: VoteDirection = "NEUTRAL";
  const diff = Math.abs(bullScore - bearScore);
  const total = bullScore + bearScore;
  const relDiff = total > 0 ? diff / total : 0;
  const isTie = total > 0 && relDiff < CONFLICT_TOLERANCE_REL;
  const elliottPrimaryVote = votes.find((v) => v.source === "ELLIOTT_PRIMARY");

  if (total === 0) {
    dominant = "NEUTRAL";
  } else if (isTie) {
    // Tie-break: if the HTF Elliott primary count is alive, its direction
    // wins the desempate. Otherwise fall back to NEUTRAL.
    dominant = elliottPrimaryVote ? elliottPrimaryVote.direction : "NEUTRAL";
  } else {
    dominant = bullScore > bearScore ? "BULLISH" : "BEARISH";
  }

  // Still report the conflict, but suppress it when a live macro Elliott
  // count is available to break the tie.
  const conflict = bullScore >= 2 && bearScore >= 2 && isTie && !elliottPrimaryVote;

  return { dominant, bullScore, bearScore, conflict, votes };
}