import { scoreLegacy, type LegacyInput, type LegacyScoreResult } from "@/lib/ml/legacy";
import type { ElliottAnalysis } from "../elliott/types";
import type { TradeSetupV2 } from "./types";

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
export interface LegacyAdapterInput {
  confirmationLevel: number;
  invalidationLevel: number;
  fibTarget1: number;
  rrToTp1: number;
  waveLabel: string | null;
  entry: number;
}

export function buildLegacyInput(
  signalOrSetup: LegacyAdapterInput | TradeSetupV2,
  elliott: ElliottAnalysis | null,
  currentPrice: number,
): LegacyInput {
  const s = signalOrSetup as Partial<TradeSetupV2> & Partial<LegacyAdapterInput>;
  // Derive the legacy contract from either a TradeSetupV2 or a raw adapter input.
  const confirmationLevel = s.entry ?? (s as LegacyAdapterInput).confirmationLevel;
  const invalidationLevel = s.sl ?? (s as LegacyAdapterInput).invalidationLevel;
  const fibTarget1 = (s as LegacyAdapterInput).fibTarget1 ?? s.tp1!;
  const rrRatio = s.rrToTp1 ?? (s as LegacyAdapterInput).rrToTp1!;
  return {
    confirmationLevel: confirmationLevel as number,
    invalidationLevel: invalidationLevel as number,
    fibTarget1: fibTarget1 as number,
    rrRatio: rrRatio as number,
    hasAlternative: !!elliott && elliott.alternatives.length > 0,
    currentPriceApprox: currentPrice,
    waveLabel: s.waveLabel ?? null,
  };
}

export function scoreSignalLegacy(input: LegacyInput): LegacyScoreResult {
  return scoreLegacy(input);
}