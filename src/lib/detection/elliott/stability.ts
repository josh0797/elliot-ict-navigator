/**
 * Scenario stability: a valid reading is not discarded just because a new
 * pivot appeared. A challenger must beat the incumbent by a configurable
 * margin AND rest on closed candles (confirmed pivots) before it can take
 * over as the primary scenario.
 */
import type { ElliottCountV2 } from "./types";

export const DEFAULT_SWITCH_MARGIN = 0.12;

export interface StabilityOptions {
  /** Minimum score advantage required to replace the incumbent. */
  margin?: number;
  /**
   * Index of the last CLOSED candle. Pivots beyond it (or unconfirmed pivots)
   * cannot promote a new primary scenario.
   */
  lastClosedIndex?: number;
}

export interface StabilityDecision {
  replace: boolean;
  reason:
    | "NO_INCUMBENT"
    | "MARGIN_NOT_MET"
    | "AWAITING_CLOSED_CANDLE"
    | "REPLACED";
}

function restsOnClosedCandles(count: ElliottCountV2, lastClosedIndex?: number): boolean {
  return count.labeled.every((l) => {
    if (!l.pivot.confirmed) return false;
    if (lastClosedIndex === undefined) return true;
    return l.pivot.index <= lastClosedIndex;
  });
}

export function shouldReplaceScenario(
  incumbent: ElliottCountV2 | null,
  challenger: ElliottCountV2,
  opts: StabilityOptions = {},
): StabilityDecision {
  if (!incumbent) return { replace: true, reason: "NO_INCUMBENT" };
  const margin = opts.margin ?? DEFAULT_SWITCH_MARGIN;
  if (challenger.score <= incumbent.score + margin) {
    return { replace: false, reason: "MARGIN_NOT_MET" };
  }
  if (!restsOnClosedCandles(challenger, opts.lastClosedIndex)) {
    return { replace: false, reason: "AWAITING_CLOSED_CANDLE" };
  }
  return { replace: true, reason: "REPLACED" };
}