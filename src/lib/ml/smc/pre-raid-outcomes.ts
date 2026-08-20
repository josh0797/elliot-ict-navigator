/**
 * Research outcomes for PRE_RAID_APPROACH_V1 observations.
 *
 * Diagnostic only: outcomes are recorded AFTER the fact and can never influence
 * the frozen pre-entry features or the setup-likeness score. They are also
 * never used to decide which minutes get captured.
 */
import type { Candle } from "@/lib/marketData/types";
import type { CandidateDirection } from "./types";

export const PRE_RAID_HORIZONS = [1, 3, 5, 15] as const;
export type PreRaidHorizon = (typeof PRE_RAID_HORIZONS)[number];

export interface PreRaidOutcome {
  horizon_minutes: PreRaidHorizon;
  /** Unix seconds of the horizon boundary (exclusive end of the window). */
  as_of: number;
  as_of_iso: string;
  directional_close_return_atr: number;
  directional_close_return_price: number;
  mfe_atr: number;
  mae_atr: number;
  /** Favorable excursion reached >= 1.0 ATR. */
  displacement_1atr: boolean;
  bars_used: number;
}

const MIN = 60;

/**
 * Compute one horizon outcome, or `null` when any required CLOSED M1 bar of the
 * window [candidateAt, candidateAt + horizon) is missing. Never interpolates.
 */
export function computePreRaidOutcome(input: {
  candidateAt: number;
  direction: CandidateDirection;
  referencePrice: number;
  atrM5: number;
  horizonMinutes: PreRaidHorizon;
  m1: readonly Candle[];
}): PreRaidOutcome | null {
  const { candidateAt, direction, referencePrice, atrM5, horizonMinutes } = input;
  if (!(atrM5 > 0) || !Number.isFinite(referencePrice)) return null;
  const end = candidateAt + horizonMinutes * MIN;

  const byTime = new Map<number, Candle>();
  for (const c of input.m1) {
    if (c.time >= candidateAt && c.time < end) byTime.set(c.time, c);
  }
  const bars: Candle[] = [];
  for (let t = candidateAt; t < end; t += MIN) {
    const bar = byTime.get(t);
    if (!bar) return null; // incomplete window — leave the horizon pending
    bars.push(bar);
  }

  const isLong = direction === "long";
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const close = bars[bars.length - 1].close;
  const favorable = isLong ? high - referencePrice : referencePrice - low;
  const adverse = isLong ? referencePrice - low : high - referencePrice;
  const closeReturn = (isLong ? close - referencePrice : referencePrice - close);

  const mfe = Math.max(0, favorable) / atrM5;
  return {
    horizon_minutes: horizonMinutes,
    as_of: end,
    as_of_iso: new Date(end * 1000).toISOString(),
    directional_close_return_atr: closeReturn / atrM5,
    directional_close_return_price: closeReturn,
    mfe_atr: mfe,
    mae_atr: Math.max(0, adverse) / atrM5,
    displacement_1atr: mfe >= 1,
    bars_used: bars.length,
  };
}