import type { ElliottAnalysis } from "../elliott/types";
import type { IctContext } from "../ict/types";
import type { TradeSignal } from "../setup/types";
import type { SetupTemplate } from "./types";

const RECENT_BARS = 15;

/**
 * Classify the operational setup template from canonical context + the
 * driving signal. Order of precedence:
 *   1. ICT reversal patterns (sweep → CHoCH → POI in opposite direction)
 *   2. Elliott wave-context entries (W3 from W2, W5 from W4, C from B)
 *   3. Continuation when last BOS aligns with direction
 */
export function classifyTemplate(
  signal: TradeSignal | null,
  elliott: ElliottAnalysis,
  ict: IctContext,
  candleCount: number,
): SetupTemplate {
  if (!signal) return "NO_VALID_TEMPLATE";
  const dir = signal.direction;
  const cutoff = candleCount - RECENT_BARS;

  const recentSweep = [...ict.sweeps]
    .reverse()
    .find((s) => s.index >= cutoff && (s.wickBeyond || s.closeBack));
  const recentChoch = [...ict.structure]
    .reverse()
    .find((e) => e.type === "CHoCH" && e.state === "CONFIRMED" && e.index >= cutoff);
  const lastBos = [...ict.structure]
    .reverse()
    .find((e) => e.type === "BOS" && e.state === "CONFIRMED");

  const reversalSweepDir =
    recentSweep && (recentSweep.type === "sell_side" ? "long" : "short");

  // 1. ICT reversal
  if (recentChoch && recentChoch.direction === dir && reversalSweepDir === dir) {
    return dir === "long" ? "ICT_BULLISH_REVERSAL" : "ICT_BEARISH_REVERSAL";
  }

  // 2. Elliott wave-context
  const wave = elliott.primary?.currentWave ?? null;
  if (wave === "2") return "ELLIOTT_WAVE_3_ENTRY";
  if (wave === "4") return "ELLIOTT_WAVE_5_ENTRY";
  if (wave === "B") return "ABC_COMPLETION_REVERSAL";

  // 3. Continuation
  if (lastBos && lastBos.direction === dir) {
    return dir === "long" ? "BULLISH_CONTINUATION" : "BEARISH_CONTINUATION";
  }

  return "NO_VALID_TEMPLATE";
}