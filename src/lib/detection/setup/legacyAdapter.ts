import { scoreLegacy, type LegacyInput, type LegacyScoreResult } from "@/lib/ml/legacy";
import type { ElliottAnalysis } from "../elliott/types";
import type { TradeSignal } from "./types";

/**
 * Map a canonical TradeSignal + Elliott analysis to the frozen
 * legacy-pretrained-html-v1 input contract. No new feature math:
 * we only forward the four fields the legacy extractor reads.
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