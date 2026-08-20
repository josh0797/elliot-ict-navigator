/**
 * SMC_M30 dataset builder — pure, deterministic, no look-ahead BY CONSTRUCTION.
 *
 * Research question: "what was present JUST BEFORE the SONIC trades that later
 * produced displacement?" Therefore:
 *  - features are built from M1 bars that are fully closed STRICTLY before the
 *    entry minute (the entry minute's own OHLC is never used — the entry second
 *    is unknown);
 *  - resampled M5/M30 buckets must be fully closed at/before the cutoff;
 *  - the M1 series is hard-truncated BEFORE any detector runs;
 *  - outcomes live in a separate slice that starts at the entry minute and is
 *    never handed to feature construction;
 *  - manual labels (clear_displacement, disp_strength, manual regime, liq_like)
 *    are audit-only and unreachable from the operative vector builder.
 *
 * Nothing here touches live alerts, setup gating or the production scorer.
 */
import { liftCandles, type CandleV2 } from "@/lib/detection/schemas/analysis";
import { atr as atrSeries } from "@/lib/detection/indicators/atr";
import { detectPivots } from "@/lib/detection/structure/pivots";
import { analyzeIct } from "@/lib/detection/ict/engine";
import type { Candle } from "@/lib/marketData/types";
import { londonClock } from "./clock";
import { buildSmcFeatures } from "./features";
import {
  projectOperativeV1,
  SMC_OPERATIVE_MASK_NAME,
  SMC_OPERATIVE_MASK_VERSION,
  SMC_OPERATIVE_V1,
} from "./masks";
import { classifySmcRegime } from "./regimes";
import {
  SMC_FEATURE_SCHEMA_VERSION,
  type CandidateDirection,
  type LondonClock,
  type SmcRegimeResult,
} from "./types";

/* ============================ types ============================ */

export type SmcEntryKind = "SONIC_ENTRY" | "MATCHED_TIME" | "HARD_NEGATIVE";

export interface SmcEntry {
  id: string;
  symbol: string;
  /** Unix seconds; resolved to minute precision internally. */
  entryTime: number;
  direction: CandidateDirection;
  /** Explicit fill price when known. */
  entryPrice?: number | null;
  kind?: SmcEntryKind;
  /** Audit-only labels imported from a manual CSV. NEVER features. */
  manualValidationLabels?: Record<string, string | number | boolean | null>;
  negative?: SmcNegativeCandidate["meta"] | null;
}

export interface SmcNegativeCandidate {
  id: string;
  symbol: string;
  entryTime: number;
  direction: CandidateDirection;
  kind: "MATCHED_TIME" | "HARD_NEGATIVE";
  meta: {
    negative_kind: "MATCHED_TIME" | "HARD_NEGATIVE";
    paired_positive_id: string;
    distance_minutes: number;
    same_date: boolean;
    same_session: boolean;
    same_m30_phase: boolean;
    seed: string;
    atr_ratio?: number | null;
    range_ratio?: number | null;
  };
}

export interface SmcDatasetOptions {
  /** Minimum strict pre-entry M1 bars required for a valid row. */
  minM1Bars?: number;
  /** Minimum resampled M5 bars required (ATR14 + pivots + structure). */
  minM5Bars?: number;
  /** Preferred M5 history depth (soft target, recorded in provenance). */
  preferM5Bars?: number;
  /** Forward outcome horizon in minutes. */
  outcomeHorizonMinutes?: number;
  /** Displacement threshold as a multiple of pre-entry ATR(M5). */
  displacementAtrMult?: number;
  /** Symmetric barrier size for fav_before_adv, in pre-entry ATR(M5). */
  barrierAtrMult?: number;
  /** Timeframe label handed to analyzeIct (session-gated constructs). */
  ictTimeframe?: string;
  /** Provider label recorded in provenance. */
  provider?: string;
}

const DEFAULTS = {
  minM1Bars: 240,
  minM5Bars: 60,
  preferM5Bars: 500,
  outcomeHorizonMinutes: 30,
  displacementAtrMult: 1.0,
  barrierAtrMult: 1.0,
  ictTimeframe: "5min",
  provider: "unknown",
} satisfies Required<SmcDatasetOptions>;

export interface SmcAuditContext {
  range_60_usd: number;
  range_120_usd: number;
  move_30_usd: number;
  direction_aligned_move_30_usd: number;
  prior_with: boolean;
  prior_against: boolean;
  in_first15_m30: boolean;
  /** Pure-price local liquidity raid diagnostics (NOT canonical ICT sweeps). */
  local_raid_high: boolean;
  local_raid_low: boolean;
  local_raid_close_back_down: boolean;
  local_raid_close_back_up: boolean;
  local_raid_reference_high: number | null;
  local_raid_reference_low: number | null;
}

export interface SmcFeatureSnapshot {
  schemaVersion: number;
  featureNames: readonly string[];
  /** Frozen raw 41-vector. */
  vector: number[];
  named: Record<string, number>;
  operativeMask: typeof SMC_OPERATIVE_MASK_NAME;
  operativeMaskVersion: number;
  operativeNames: readonly string[];
  /** Projected 22-vector (mask order). */
  operativeVector: number[];
  clock: LondonClock;
  direction: CandidateDirection;
  atTime: number;
  atrM5: number;
  /** Diagnostic only — never a feature, never used to derive outcomes. */
  regime: SmcRegimeResult;
  audit: SmcAuditContext;
}

export type FavBeforeAdvState =
  | "FAVORABLE_FIRST"
  | "ADVERSE_FIRST"
  | "NEITHER"
  | "AMBIGUOUS_SAME_BAR";

export interface SmcOutcomes {
  entry_price: number;
  entry_price_source: "provided" | "entry_minute_open";
  mfe_usd: number;
  mae_usd: number;
  mfe_atr: number;
  mae_atr: number;
  forward_net_5m_usd: number | null;
  forward_net_15m_usd: number | null;
  forward_net_30m_usd: number | null;
  forward_mfe_5m_usd: number | null;
  forward_mfe_15m_usd: number | null;
  forward_mfe_30m_usd: number | null;
  time_to_positive_displacement_s: number | null;
  time_to_adverse_displacement_s: number | null;
  time_to_invalidation_s: number | null;
  positive_displacement_5m: boolean;
  positive_displacement_15m: boolean;
  fav_before_adv: boolean | null;
  fav_before_adv_state: FavBeforeAdvState;
  outcome_coverage_minutes: number;
  meta: {
    displacement_threshold_usd: number;
    displacement_atr_mult: number;
    barrier_usd: number;
    barrier_atr_mult: number;
    atr_source: "pre_entry_atr_m5";
    atr_used: number;
    horizon_minutes: number;
  };
}

export interface SmcProvenance {
  source: string;
  symbol: string;
  entry_time: number;
  entry_minute: number;
  /** Close-time of the last usable M1 bar == entry minute open. */
  feature_cutoff_time: number;
  last_m1_open_used: number | null;
  last_m1_close_time_used: number | null;
  m1_bars: number;
  m5_bars: number;
  m30_bars: number;
  first_source_bar_time: number | null;
  last_source_bar_time: number | null;
  strict_cutoff_satisfied: boolean;
  feature_schema_version: number;
  operative_mask: string;
  operative_mask_version: number;
  prefer_m5_bars_met: boolean;
}

export interface SmcDatasetRow {
  id: string;
  symbol: string;
  source_entry_id: string;
  paired_positive_id: string | null;
  is_sonic_entry: 0 | 1;
  kind: SmcEntryKind;
  direction: CandidateDirection;
  entry_time: number;
  valid: boolean;
  invalid_reason: string | null;
  features: SmcFeatureSnapshot | null;
  outcomes: SmcOutcomes | null;
  provenance: SmcProvenance;
  negative: SmcNegativeCandidate["meta"] | null;
  /** Audit-only manual labels. Unreachable from the feature builder. */
  manual_validation_labels: Record<string, string | number | boolean | null> | null;
}

export type OhlcvLoader = (req: {
  symbol: string;
  fromSec: number;
  toSec: number;
}) => Promise<Candle[]> | Candle[];

/* ============================ helpers ============================ */

const MIN = 60;

export function floorToMinute(t: number): number {
  return Math.floor(t / MIN) * MIN;
}

function sortBars(bars: readonly Candle[]): Candle[] {
  return [...bars]
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v)),
    )
    .sort((a, b) => a.time - b.time);
}

/**
 * Strict feature window: M1 bars whose open is < entryMinute (so their close is
 * <= entryMinute). The entry-minute bar itself is excluded.
 */
export function buildFeatureWindow(
  m1: readonly Candle[],
  entryTime: number,
): { bars: Candle[]; cutoff: number } {
  const entryMinute = floorToMinute(entryTime);
  const bars = sortBars(m1).filter((c) => c.time < entryMinute && c.time + MIN <= entryMinute);
  return { bars, cutoff: entryMinute };
}

/** Forward slice: M1 bars from the entry minute onwards (outcomes only). */
export function buildOutcomeWindow(
  m1: readonly Candle[],
  entryTime: number,
  horizonMinutes: number,
): Candle[] {
  const entryMinute = floorToMinute(entryTime);
  const end = entryMinute + horizonMinutes * MIN;
  return sortBars(m1).filter((c) => c.time >= entryMinute && c.time < end);
}

/** Resample closed M1 bars into fully closed buckets of `seconds`. */
export function resampleClosed(m1: readonly Candle[], seconds: number, cutoff: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of m1) {
    const start = Math.floor(c.time / seconds) * seconds;
    if (start + seconds > cutoff) continue; // partial bucket — never used
    const cur = buckets.get(start);
    if (!cur) {
      buckets.set(start, {
        time: start,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      });
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function rangeOfLast(bars: readonly Candle[], n: number): number {
  const slice = bars.slice(Math.max(0, bars.length - n));
  if (!slice.length) return 0;
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of slice) {
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
  }
  return Number.isFinite(hi) && Number.isFinite(lo) ? hi - lo : 0;
}

function buildAuditContext(
  m1: readonly Candle[],
  entryTime: number,
  direction: CandidateDirection,
): SmcAuditContext {
  const dirSign = direction === "long" ? 1 : -1;
  const last = m1[m1.length - 1] ?? null;
  const ref30 = m1.length >= 31 ? m1[m1.length - 31] : null;
  const move30 = last && ref30 ? last.close - ref30.close : 0;
  const aligned = move30 * dirSign;

  // Local liquidity raid: last 30 strict bars vs the 90 minutes before them.
  const recent = m1.slice(Math.max(0, m1.length - 30));
  const priorStart = Math.max(0, m1.length - 120);
  const prior = m1.slice(priorStart, Math.max(priorStart, m1.length - 30));
  let refHigh: number | null = null;
  let refLow: number | null = null;
  for (const c of prior) {
    refHigh = refHigh === null ? c.high : Math.max(refHigh, c.high);
    refLow = refLow === null ? c.low : Math.min(refLow, c.low);
  }
  const raidHigh = refHigh !== null && recent.some((c) => c.high > refHigh!);
  const raidLow = refLow !== null && recent.some((c) => c.low < refLow!);

  return {
    range_60_usd: rangeOfLast(m1, 60),
    range_120_usd: rangeOfLast(m1, 120),
    move_30_usd: move30,
    direction_aligned_move_30_usd: aligned,
    prior_with: aligned > 1.5,
    prior_against: aligned < -1.5,
    in_first15_m30: londonClock(floorToMinute(entryTime)).inFirst15mAfterM30,
    local_raid_high: raidHigh,
    local_raid_low: raidLow,
    // Rejection back inside the reference range, using pre-entry bars only.
    local_raid_close_back_down: raidHigh && !!last && refHigh !== null && last.close < refHigh,
    local_raid_close_back_up: raidLow && !!last && refLow !== null && last.close > refLow,
    local_raid_reference_high: refHigh,
    local_raid_reference_low: refLow,
  };
}

function previousDayRange(m1: readonly Candle[], cutoff: number): { high: number; low: number } | null {
  const DAY = 86400;
  const today = Math.floor(cutoff / DAY) * DAY;
  const prevStart = today - DAY;
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of m1) {
    if (c.time >= prevStart && c.time < today) {
      hi = Math.max(hi, c.high);
      lo = Math.min(lo, c.low);
    }
  }
  return Number.isFinite(hi) && Number.isFinite(lo) ? { high: hi, low: lo } : null;
}

function asiaRangeOf(
  m1: readonly Candle[],
  cutoff: number,
): { high: number; low: number; sweptHigh: boolean; sweptLow: boolean } | null {
  const localDate = londonClock(cutoff).localDate;
  let hi = -Infinity;
  let lo = Infinity;
  let asiaEnd = -Infinity;
  for (const c of m1) {
    const clk = londonClock(c.time);
    if (clk.localDate !== localDate || clk.session !== "ASIA") continue;
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
    asiaEnd = Math.max(asiaEnd, c.time);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  let sweptHigh = false;
  let sweptLow = false;
  for (const c of m1) {
    if (c.time <= asiaEnd) continue;
    if (c.high > hi) sweptHigh = true;
    if (c.low < lo) sweptLow = true;
  }
  return { high: hi, low: lo, sweptHigh, sweptLow };
}

/* ======================= single-row builder ======================= */

export function buildSmcDatasetRow(
  entry: SmcEntry,
  m1Bars: readonly Candle[],
  options: SmcDatasetOptions = {},
): SmcDatasetRow {
  const opt = { ...DEFAULTS, ...options };
  const kind: SmcEntryKind = entry.kind ?? "SONIC_ENTRY";
  const all = sortBars(m1Bars);
  const { bars: featureM1, cutoff } = buildFeatureWindow(all, entry.entryTime);
  const m5 = resampleClosed(featureM1, 300, cutoff);
  const m30 = resampleClosed(featureM1, 1800, cutoff);
  const lastM1 = featureM1[featureM1.length - 1] ?? null;

  const provenance: SmcProvenance = {
    source: opt.provider,
    symbol: entry.symbol,
    entry_time: entry.entryTime,
    entry_minute: cutoff,
    feature_cutoff_time: cutoff,
    last_m1_open_used: lastM1 ? lastM1.time : null,
    last_m1_close_time_used: lastM1 ? lastM1.time + MIN : null,
    m1_bars: featureM1.length,
    m5_bars: m5.length,
    m30_bars: m30.length,
    first_source_bar_time: all.length ? all[0].time : null,
    last_source_bar_time: all.length ? all[all.length - 1].time : null,
    strict_cutoff_satisfied: !lastM1 || lastM1.time + MIN <= cutoff,
    feature_schema_version: SMC_FEATURE_SCHEMA_VERSION,
    operative_mask: SMC_OPERATIVE_MASK_NAME,
    operative_mask_version: SMC_OPERATIVE_MASK_VERSION,
    prefer_m5_bars_met: m5.length >= opt.preferM5Bars,
  };

  const base: SmcDatasetRow = {
    id: entry.id,
    symbol: entry.symbol,
    source_entry_id: entry.negative?.paired_positive_id ?? entry.id,
    paired_positive_id: entry.negative?.paired_positive_id ?? null,
    is_sonic_entry: kind === "SONIC_ENTRY" ? 1 : 0,
    kind,
    direction: entry.direction,
    entry_time: entry.entryTime,
    valid: false,
    invalid_reason: null,
    features: null,
    outcomes: null,
    provenance,
    negative: entry.negative ?? null,
    manual_validation_labels: entry.manualValidationLabels ?? null,
  };

  if (featureM1.length < opt.minM1Bars) {
    return { ...base, invalid_reason: `insufficient_m1_history:${featureM1.length}` };
  }
  if (m5.length < opt.minM5Bars) {
    return { ...base, invalid_reason: `insufficient_m5_history:${m5.length}` };
  }
  const hasPrevDay = previousDayRange(featureM1, cutoff) !== null;

  /* ---- canonical pipeline on the TRUNCATED series only ---- */
  const lifted: CandleV2[] = liftCandles(m5);
  const atrM5Series = atrSeries(lifted, 14);
  const pivots = detectPivots(lifted);
  const ict = analyzeIct(lifted, pivots, { timeframe: opt.ictTimeframe });

  const ctx = {
    candles: m5,
    atTime: m5[m5.length - 1].time,
    direction: entry.direction,
    atr: atrM5Series,
    liquidity: ict.liquidity,
    sweeps: ict.sweeps,
    structure: ict.structure,
    fvgs: ict.fvgs,
    orderBlocks: ict.orderBlocks,
    pdArray: ict.pdArray,
    previousDay: previousDayRange(featureM1, cutoff),
    asiaRange: asiaRangeOf(featureM1, cutoff),
  };

  const feat = buildSmcFeatures(ctx);
  const regime = classifySmcRegime(ctx);
  const atrM5 = [...atrM5Series].reverse().find((v) => Number.isFinite(v) && v > 0) ?? 0;

  const features: SmcFeatureSnapshot = {
    schemaVersion: feat.schemaVersion,
    featureNames: feat.featureNames,
    vector: feat.vector,
    named: feat.named,
    operativeMask: SMC_OPERATIVE_MASK_NAME,
    operativeMaskVersion: SMC_OPERATIVE_MASK_VERSION,
    operativeNames: SMC_OPERATIVE_V1,
    operativeVector: projectOperativeV1(feat.vector),
    clock: londonClock(cutoff),
    direction: feat.direction,
    atTime: feat.atTime,
    atrM5,
    regime,
    audit: buildAuditContext(featureM1, entry.entryTime, entry.direction),
  };

  const outcomes = computeOutcomes(entry, all, atrM5, opt);

  return {
    ...base,
    valid: true,
    invalid_reason: hasPrevDay ? null : "warn_missing_previous_day",
    features,
    outcomes,
  };
}

/* ============================ outcomes ============================ */

function computeOutcomes(
  entry: SmcEntry,
  allBars: readonly Candle[],
  atrM5: number,
  opt: Required<SmcDatasetOptions>,
): SmcOutcomes | null {
  const entryMinute = floorToMinute(entry.entryTime);
  const fwd = buildOutcomeWindow(allBars, entry.entryTime, opt.outcomeHorizonMinutes);
  if (!fwd.length) return null;

  const provided = Number.isFinite(entry.entryPrice as number) ? (entry.entryPrice as number) : null;
  const entryPrice = provided ?? fwd[0].open;
  const source: SmcOutcomes["entry_price_source"] = provided !== null ? "provided" : "entry_minute_open";
  const dirSign = entry.direction === "long" ? 1 : -1;

  const threshold = atrM5 * opt.displacementAtrMult;
  const barrier = atrM5 * opt.barrierAtrMult;

  let mfe = 0;
  let mae = 0;
  let tPos: number | null = null;
  let tAdv: number | null = null;
  let favState: FavBeforeAdvState = "NEITHER";
  let settled = false;

  const netAt = (minutes: number): number | null => {
    const end = entryMinute + minutes * MIN;
    const bar = [...fwd].reverse().find((c) => c.time < end);
    if (!bar || bar.time + MIN > end) return null;
    return (bar.close - entryPrice) * dirSign;
  };
  const mfeAt = (minutes: number): number | null => {
    const end = entryMinute + minutes * MIN;
    const slice = fwd.filter((c) => c.time < end);
    if (!slice.length) return null;
    return slice.reduce(
      (m, c) => Math.max(m, (dirSign > 0 ? c.high - entryPrice : entryPrice - c.low) * 1),
      0,
    );
  };

  for (const c of fwd) {
    const fav = dirSign > 0 ? c.high - entryPrice : entryPrice - c.low;
    const adv = dirSign > 0 ? entryPrice - c.low : c.high - entryPrice;
    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);
    const closeTime = c.time + MIN - entryMinute;
    if (tPos === null && threshold > 0 && fav >= threshold) tPos = closeTime;
    if (tAdv === null && threshold > 0 && adv >= threshold) tAdv = closeTime;
    if (!settled && barrier > 0) {
      const hitFav = fav >= barrier;
      const hitAdv = adv >= barrier;
      if (hitFav && hitAdv) {
        favState = "AMBIGUOUS_SAME_BAR";
        settled = true;
      } else if (hitFav) {
        favState = "FAVORABLE_FIRST";
        settled = true;
      } else if (hitAdv) {
        favState = "ADVERSE_FIRST";
        settled = true;
      }
    }
  }

  const displacedWithin = (minutes: number): boolean => {
    if (threshold <= 0) return false;
    const end = entryMinute + minutes * MIN;
    return fwd.some((c) => {
      if (c.time >= end) return false;
      const fav = dirSign > 0 ? c.high - entryPrice : entryPrice - c.low;
      return fav >= threshold;
    });
  };

  return {
    entry_price: entryPrice,
    entry_price_source: source,
    mfe_usd: mfe,
    mae_usd: mae,
    mfe_atr: atrM5 > 0 ? mfe / atrM5 : 0,
    mae_atr: atrM5 > 0 ? mae / atrM5 : 0,
    forward_net_5m_usd: netAt(5),
    forward_net_15m_usd: netAt(15),
    forward_net_30m_usd: netAt(30),
    forward_mfe_5m_usd: mfeAt(5),
    forward_mfe_15m_usd: mfeAt(15),
    forward_mfe_30m_usd: mfeAt(30),
    time_to_positive_displacement_s: tPos,
    time_to_adverse_displacement_s: tAdv,
    time_to_invalidation_s: tAdv,
    positive_displacement_5m: displacedWithin(5),
    positive_displacement_15m: displacedWithin(15),
    fav_before_adv:
      favState === "FAVORABLE_FIRST" ? true : favState === "ADVERSE_FIRST" ? false : null,
    fav_before_adv_state: favState,
    outcome_coverage_minutes: fwd.length,
    meta: {
      displacement_threshold_usd: threshold,
      displacement_atr_mult: opt.displacementAtrMult,
      barrier_usd: barrier,
      barrier_atr_mult: opt.barrierAtrMult,
      atr_source: "pre_entry_atr_m5",
      atr_used: atrM5,
      horizon_minutes: opt.outcomeHorizonMinutes,
    },
  };
}

/* ============================ batch API ============================ */

export interface SmcDatasetResult {
  rows: SmcDatasetRow[];
  skipped: Array<{ entryId: string; reason: string }>;
  options: Required<SmcDatasetOptions>;
}

/** Load history per entry and build rows. Loader must return M1 candles. */
export async function buildSmcDataset(
  entries: readonly SmcEntry[],
  ohlcvLoader: OhlcvLoader,
  options: SmcDatasetOptions = {},
): Promise<SmcDatasetResult> {
  const opt = { ...DEFAULTS, ...options };
  const rows: SmcDatasetRow[] = [];
  const skipped: Array<{ entryId: string; reason: string }> = [];
  for (const entry of entries) {
    const entryMinute = floorToMinute(entry.entryTime);
    const fromSec = entryMinute - 3 * 86400;
    const toSec = entryMinute + (opt.outcomeHorizonMinutes + 5) * MIN;
    let bars: Candle[] = [];
    try {
      bars = [...(await ohlcvLoader({ symbol: entry.symbol, fromSec, toSec }))];
    } catch (err) {
      skipped.push({ entryId: entry.id, reason: `loader_error:${(err as Error).message}` });
      continue;
    }
    if (!bars.length) {
      skipped.push({ entryId: entry.id, reason: "no_coverage" });
      continue;
    }
    rows.push(buildSmcDatasetRow(entry, bars, opt));
  }
  return { rows, skipped, options: opt };
}
