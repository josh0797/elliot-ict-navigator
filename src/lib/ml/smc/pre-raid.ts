/**
 * PRE_RAID_APPROACH_V1 — deterministic, NON-TRAINED "SONIC-likeness" detector.
 *
 * Provenance: Phase 3A-bis read-only research
 * (`/mnt/documents/phase3abis-feature-set.json`, `phase3abis-report.md`).
 * The 5 features below are the only sign-stable, low-redundancy paired
 * pre-entry features found across TRAIN/VAL/TEST. The frozen medians and signs
 * are copied verbatim from that artifact and MUST NOT be re-fit from live data.
 *
 * IMPORTANT SEMANTICS — the research verdict (Phase 3B: NO-GO) was that the
 * score recognises *which minutes SONIC selects as a setup*, and is NOT
 * monotone for outcome/displacement. Therefore `setupScore` is
 * **setup-likeness / diagnostic quality**, NEVER a win probability.
 *
 * Isolation contract: this module imports NOTHING from Elliott, logreg, the
 * model manager, the decision engine or the setup engine. It is diagnostic
 * only and never participates in gating, scoring or alerts.
 */
import type { Candle } from "@/lib/marketData/types";
import { londonClock } from "./clock";
import type { CandidateDirection, LondonClock } from "./types";

export const PRE_RAID_DETECTOR_VERSION = "PRE_RAID_APPROACH_V1";
export const PRE_RAID_DETECTOR_LABEL = "SONIC-likeness (PRE_RAID_APPROACH_V1)";

/** Validated Phase 3A/3A-bis London research window: 06:00–07:59 local. */
export const PRE_RAID_WINDOW_START_MINUTE = 6 * 60;
export const PRE_RAID_WINDOW_END_MINUTE = 8 * 60;

export const PRE_RAID_FEATURE_NAMES = [
  "dist_relevant_local_liq_atr",
  "micro_hhhl_score_5",
  "minutes_since_relevant_raid_norm",
  "position_in_asia_range_dir",
  "approach_velocity_liq_3m_atr",
] as const;

export type PreRaidFeatureName = (typeof PRE_RAID_FEATURE_NAMES)[number];

/** FROZEN TRAIN medians — Phase 3A-bis `train_median_threshold`. Do not re-fit. */
export const PRE_RAID_TRAIN_MEDIANS: Readonly<Record<PreRaidFeatureName, number>> = {
  dist_relevant_local_liq_atr: 1.911168,
  micro_hhhl_score_5: 0.0,
  minutes_since_relevant_raid_norm: 1.0,
  position_in_asia_range_dir: 0.393471,
  approach_velocity_liq_3m_atr: 0.021757,
};

/** FROZEN TRAIN signs — Phase 3A-bis `train_sign`. Do not re-fit. */
export const PRE_RAID_TRAIN_SIGNS: Readonly<Record<PreRaidFeatureName, 1 | -1>> = {
  dist_relevant_local_liq_atr: -1,
  micro_hhhl_score_5: -1,
  minutes_since_relevant_raid_norm: -1,
  position_in_asia_range_dir: 1,
  approach_velocity_liq_3m_atr: 1,
};

export type PreRaidRaidState =
  | "NO_RAID_YET"
  | "RAID_ACTIVE_0M"
  | "RAID_RECENT_LE_5M"
  | "RAID_MID_LE_15M"
  | "RAID_OLD_GT_15M";

export interface PreRaidComponent {
  name: PreRaidFeatureName;
  value: number;
  trainMedian: number;
  trainSign: 1 | -1;
  pass: boolean;
}

export interface PreRaidObservation {
  ok: true;
  detectorVersion: typeof PRE_RAID_DETECTOR_VERSION;
  symbol: string;
  candidateAt: number;
  direction: CandidateDirection;
  referencePrice: number;
  atrM5: number;
  lastClosedM1At: number;
  /** 0..5 */
  componentCount: number;
  /** componentCount / 5 — setup-likeness, NOT a probability. */
  setupScore: number;
  components: PreRaidComponent[];
  features: Record<PreRaidFeatureName, number>;
  /** Requested aliases. */
  distLiquidity: number;
  approachVelocity: number;
  microPullback: number;
  asiaPosition: number;
  raidState: PreRaidRaidState;
  minutesSinceRelevantRaidNorm: number;
  london: LondonClock;
  /** Minutes elapsed inside the current M30 block (audit only, never scored). */
  m30PhaseMinute: number;
  /** The relevant untouched local liquidity level the approach is measured to. */
  relevantLevel: number;
  inValidatedWindow: boolean;
}

export interface PreRaidSkipped {
  ok: false;
  detectorVersion: typeof PRE_RAID_DETECTOR_VERSION;
  symbol: string;
  candidateAt: number;
  direction: CandidateDirection;
  reason: PreRaidSkipReason;
}

export type PreRaidSkipReason =
  | "NO_CLOSED_M1"
  | "M1_GAP_AT_CANDIDATE"
  | "INSUFFICIENT_M1_HISTORY"
  | "ATR_UNAVAILABLE"
  | "LIQUIDITY_WINDOW_UNAVAILABLE"
  | "ASIA_RANGE_UNAVAILABLE";

export type PreRaidResult = PreRaidObservation | PreRaidSkipped;

const MIN = 60;
const ATR_PERIOD = 14;
/** Relevant local liquidity window: [candidate-60m, candidate-10m). */
const LIQ_WINDOW_FROM = 60 * MIN;
const LIQ_WINDOW_TO = 10 * MIN;
const RAID_LOOKBACK_BARS = 30;

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Wilder ATR over the supplied bars; returns the last value or NaN. */
export function wilderAtr(bars: readonly Candle[], period = ATR_PERIOD): number {
  if (bars.length < period + 1) return NaN;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const c = bars[i];
    const prev = bars[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  if (tr.length < period) return NaN;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
}

/** Aggregate closed M1 bars into fully-closed buckets of `seconds` before `cutoff`. */
export function bucketClosed(m1: readonly Candle[], seconds: number, cutoff: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of m1) {
    const start = Math.floor(c.time / seconds) * seconds;
    if (start + seconds > cutoff) continue; // partial bucket — never used
    const cur = buckets.get(start);
    if (!cur) buckets.set(start, { ...c, time: start });
    else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function raidStateOf(norm: number, barsSince: number | null): PreRaidRaidState {
  if (barsSince === null) return "NO_RAID_YET";
  if (barsSince === 0) return "RAID_ACTIVE_0M";
  if (barsSince <= 5) return "RAID_RECENT_LE_5M";
  if (barsSince <= 15) return "RAID_MID_LE_15M";
  return norm >= 1 ? "NO_RAID_YET" : "RAID_OLD_GT_15M";
}

/** True when the candidate minute sits inside the validated London window. */
export function inPreRaidWindow(candidateAt: number): boolean {
  const clock = londonClock(candidateAt);
  return (
    clock.dayOfWeek >= 1 &&
    clock.dayOfWeek <= 5 &&
    clock.minuteOfDay >= PRE_RAID_WINDOW_START_MINUTE &&
    clock.minuteOfDay < PRE_RAID_WINDOW_END_MINUTE
  );
}

/**
 * Score one candidate minute for one direction.
 *
 * STRICTLY pre-candidate: only M1 bars that CLOSED at or before `candidateAt`
 * are read (`bar.time + 60 <= candidateAt`). The candidate/partial minute and
 * everything after it can never influence the result.
 */
export function scorePreRaidApproach(input: {
  symbol: string;
  candidateAt: number;
  direction: CandidateDirection;
  m1: readonly Candle[];
}): PreRaidResult {
  const { symbol, direction } = input;
  const candidateAt = Math.floor(input.candidateAt / MIN) * MIN;
  const skip = (reason: PreRaidSkipReason): PreRaidSkipped => ({
    ok: false,
    detectorVersion: PRE_RAID_DETECTOR_VERSION,
    symbol,
    candidateAt,
    direction,
    reason,
  });

  const closed = input.m1
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.time + MIN <= candidateAt,
    )
    .sort((a, b) => a.time - b.time);
  if (!closed.length) return skip("NO_CLOSED_M1");

  const lastClosed = closed[closed.length - 1];
  if (lastClosed.time !== candidateAt - MIN) return skip("M1_GAP_AT_CANDIDATE");
  if (closed.length < 6) return skip("INSUFFICIENT_M1_HISTORY");

  const m5 = bucketClosed(closed, 5 * MIN, candidateAt);
  const atrM5 = wilderAtr(m5, ATR_PERIOD);
  if (!Number.isFinite(atrM5) || atrM5 <= 0) return skip("ATR_UNAVAILABLE");

  // 1) Relevant untouched local liquidity, window [candidate-60m, candidate-10m).
  const liqWindow = closed.filter(
    (c) => c.time >= candidateAt - LIQ_WINDOW_FROM && c.time < candidateAt - LIQ_WINDOW_TO,
  );
  if (liqWindow.length < 10) return skip("LIQUIDITY_WINDOW_UNAVAILABLE");
  const isLong = direction === "long";
  const relevantLevel = isLong
    ? Math.min(...liqWindow.map((c) => c.low))
    : Math.max(...liqWindow.map((c) => c.high));
  const distAtr = (price: number) =>
    (isLong ? price - relevantLevel : relevantLevel - price) / atrM5;
  const distLiquidity = distAtr(lastClosed.close);

  // 2) micro HH/HL score over the last 5 closed M1 (4 consecutive comparisons).
  const last5 = closed.slice(-5);
  let hhhl = 0;
  for (let i = 1; i < last5.length; i++) {
    hhhl += sign(last5[i].high - last5[i - 1].high) + sign(last5[i].low - last5[i - 1].low);
  }
  const microPullback = (hhhl / (2 * 4)) * (isLong ? 1 : -1);

  // 3) minutes since the relevant level was raided, normalised over 30 bars.
  const raidWindow = closed.slice(-RAID_LOOKBACK_BARS);
  let raidIdx: number | null = null;
  for (let i = raidWindow.length - 1; i >= 0; i--) {
    const beyond = isLong
      ? raidWindow[i].low < relevantLevel
      : raidWindow[i].high > relevantLevel;
    if (beyond) {
      raidIdx = i;
      break;
    }
  }
  const barsSinceRaid = raidIdx === null ? null : raidWindow.length - 1 - raidIdx;
  const minutesSinceRelevantRaidNorm =
    barsSinceRaid === null ? 1 : Math.min(1, barsSinceRaid / RAID_LOOKBACK_BARS);

  // 4) Position of the pre-entry close in the Asia range (00:00–06:00 London).
  const clock = londonClock(candidateAt);
  const [ly, lm, ld] = clock.localDate.split("-").map(Number);
  const localMidnightUtc = Date.UTC(ly, lm - 1, ld) / 1000 - clock.utcOffsetMinutes * MIN;
  const asiaBars = closed.filter(
    (c) => c.time >= localMidnightUtc && c.time < localMidnightUtc + 6 * 3600,
  );
  if (asiaBars.length < 30) return skip("ASIA_RANGE_UNAVAILABLE");
  const asiaHigh = Math.max(...asiaBars.map((c) => c.high));
  const asiaLow = Math.min(...asiaBars.map((c) => c.low));
  const asiaWidth = asiaHigh - asiaLow;
  if (!(asiaWidth > 0)) return skip("ASIA_RANGE_UNAVAILABLE");
  const rawPos = (lastClosed.close - asiaLow) / asiaWidth;
  const asiaPosition = isLong ? 1 - rawPos : rawPos;

  // 5) Approach velocity over the last 3 closed M1, same relevant level.
  const threeAgo = closed[closed.length - 4];
  const approachVelocity = (distAtr(threeAgo.close) - distLiquidity) / 3;

  const features: Record<PreRaidFeatureName, number> = {
    dist_relevant_local_liq_atr: distLiquidity,
    micro_hhhl_score_5: microPullback,
    minutes_since_relevant_raid_norm: minutesSinceRelevantRaidNorm,
    position_in_asia_range_dir: asiaPosition,
    approach_velocity_liq_3m_atr: approachVelocity,
  };

  const components: PreRaidComponent[] = PRE_RAID_FEATURE_NAMES.map((name) => {
    const value = features[name];
    const trainMedian = PRE_RAID_TRAIN_MEDIANS[name];
    const trainSign = PRE_RAID_TRAIN_SIGNS[name];
    return {
      name,
      value,
      trainMedian,
      trainSign,
      pass: (value - trainMedian) * trainSign > 0,
    };
  });
  const componentCount = components.filter((c) => c.pass).length;

  return {
    ok: true,
    detectorVersion: PRE_RAID_DETECTOR_VERSION,
    symbol,
    candidateAt,
    direction,
    referencePrice: lastClosed.close,
    atrM5,
    lastClosedM1At: lastClosed.time,
    componentCount,
    setupScore: componentCount / 5,
    components,
    features,
    distLiquidity,
    approachVelocity,
    microPullback,
    asiaPosition,
    raidState: raidStateOf(minutesSinceRelevantRaidNorm, barsSinceRaid),
    minutesSinceRelevantRaidNorm,
    london: clock,
    m30PhaseMinute: clock.minutesFromM30Boundary,
    relevantLevel,
    inValidatedWindow: inPreRaidWindow(candidateAt),
  };
}