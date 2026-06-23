import type { ElliottAnalysis } from "../elliott/types";
import type { IctContext } from "../ict/types";
import type { DirectionBiasResult, DirectionVote, VoteDirection } from "./types";

const RECENT_BARS = 10;
const CONFLICT_TOLERANCE = 1.5;

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
  } else if (elliott.alternatives.length > 0) {
    const alt = elliott.alternatives[0];
    votes.push({
      source: "ELLIOTT_ALTERNATIVE",
      direction: alt.direction === "long" ? "BULLISH" : "BEARISH",
      weight: 1.0,
      reason: `Primary invalidated — using alternative ${alt.pattern}`,
    });
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

  // 6. Recent sweep (sell_side raid → bullish reaction expected; vice-versa)
  const cutoff = candleCount - RECENT_BARS;
  const sweep = [...ict.sweeps].reverse().find((s) => s.index >= cutoff && (s.wickBeyond || s.closeBack));
  if (sweep) {
    votes.push({
      source: "ICT_SWEEP",
      direction: sweep.type === "sell_side" ? "BULLISH" : "BEARISH",
      weight: 1.5,
      reason: `${sweep.type === "sell_side" ? "SSL" : "BSL"} sweep ${sweep.closeBack ? "with close-back" : ""}`,
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
  if (bullScore === 0 && bearScore === 0) dominant = "NEUTRAL";
  else if (Math.abs(bullScore - bearScore) < CONFLICT_TOLERANCE) dominant = "NEUTRAL";
  else dominant = bullScore > bearScore ? "BULLISH" : "BEARISH";

  const conflict =
    bullScore >= 2 && bearScore >= 2 && Math.abs(bullScore - bearScore) < CONFLICT_TOLERANCE;

  return { dominant, bullScore, bearScore, conflict, votes };
}