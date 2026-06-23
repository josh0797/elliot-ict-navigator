import { scoreLegacy, type LegacyInput, type LegacyScoreResult } from "@/lib/ml/legacy";
import type { ElliottAnalysis } from "../elliott/types";
import type { TradeSignal } from "./types";

/**
 * Map a canonical TradeSignal + Elliott analysis to the frozen
 * legacy-pretrained-html-v1 input contract. No new feature math.
 *
 * Forwarded fields (seven total, matching `LegacyInput`):
 *   confirmationLevel, invalidationLevel, fibTarget1, rrRatio,
 *   hasAlternative, currentPriceApprox, waveLabel.
 *
 * Contract invariant: `fibTarget1` and `rrRatio` MUST reference the same
 * take-profit target (TP1) so legacy features f0 (tp/sl ratio) and f3
 * (rrNorm) stay coherent with the original training pipeline.
 *
 * `currentPrice` must be the close of the last CONFIRMED candle at signal
 * creation time, frozen into the signal snapshot — never the live price.
 */
export function buildLegacyInput(
  signal: Pick<TradeSignal, "confirmationLevel" | "invalidationLevel" | "fibTarget1" | "rrToTp1" | "waveLabel" | "entry">,
  elliott: ElliottAnalysis | null,
  currentPrice: number,
): LegacyInput {
  return {
    confirmationLevel: signal.confirmationLevel,
    invalidationLevel: signal.invalidationLevel,
    fibTarget1: signal.fibTarget1,
    rrRatio: signal.rrToTp1,
    hasAlternative: !!elliott && elliott.alternatives.length > 0,
    currentPriceApprox: currentPrice,
    waveLabel: signal.waveLabel,
  };
}

export function scoreSignalLegacy(input: LegacyInput): LegacyScoreResult {
  return scoreLegacy(input);
}