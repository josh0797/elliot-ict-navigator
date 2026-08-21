/**
 * SONIC AUDIT — read-only audit of what PRE_RAID_APPROACH_V1 is collecting.
 *
 * Runs as the signed-in user (RLS SELECT on `pre_raid_observations`). It never
 * writes, never recomputes features and never influences the detector, the
 * decision engine, alerts or scoring. Pure observability over the frozen
 * research table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { PRE_RAID_DETECTOR_VERSION, PRE_RAID_FEATURE_NAMES } from "./pre-raid";
import { PRE_RAID_HORIZONS } from "./pre-raid-outcomes";
import { preRaidWindowStatus } from "./pre-raid.server";

export interface PreRaidAuditRow {
  id: string;
  candidate_at: string;
  direction: "long" | "short";
  reference_price: number;
  atr_m5: number;
  setup_score: number;
  component_count: number;
  dist_liquidity: number | null;
  approach_velocity: number | null;
  micro_pullback: number | null;
  asia_position: number | null;
  raid_state: string | null;
  minutes_since_relevant_raid_norm: number | null;
  provider: string | null;
  source_last_closed_at: string | null;
  components: Json;
  features: Json;
  london_context: Json;
  outcome_1m: Json;
  outcome_3m: Json;
  outcome_5m: Json;
  outcome_15m: Json;
  outcomes_updated_at: string | null;
  created_at: string;
}

export interface HorizonStats {
  horizon: number;
  resolved: number;
  displacement: number;
  displacementRate: number | null;
  avgMfeAtr: number | null;
  avgMaeAtr: number | null;
}

/** Server-side aggregates over EVERY row matching the active filters. */
export interface PreRaidDatasetContext {
  /** Rows scanned server-side (capped by DATASET_SCAN_CAP). */
  totalObservations: number;
  /** True when the scan hit the safety cap. */
  truncated: boolean;
  uniqueCandidateMinutes: number;
  /** Minutes holding BOTH a long and a short observation. */
  pairedMinutes: number;
  captureDays: number;
  componentHistogram: number[];
  long: {
    count: number;
    avgComponentCount: number | null;
    fullHouse: number;
    fullHouseRate: number | null;
    /** Pass rate per frozen feature (0..1). */
    featurePassRate: Record<string, number | null>;
    /** Frequency of each component_count bucket 0..5. */
    componentHistogram: number[];
  };
  short: PreRaidDatasetContext["long"];
  providers: Record<string, number>;
  /** Rows with a stored (non-null) outcome per horizon. */
  outcomeMaturity: { horizon: number; resolved: number; total: number }[];
  /** True when no horizon has enough resolved rows for retrospective stats. */
  noCalibration: boolean;
}

export interface PreRaidAuditResult {
  detectorVersion: string;
  symbol: string;
  days: number;
  window: ReturnType<typeof preRaidWindowStatus>;
  asOf: number;
  /** Newest first, capped by `limit`. */
  rows: PreRaidAuditRow[];
  featureNames: readonly string[];
  summary: {
    total: number;
    long: number;
    short: number;
    /** Rows with at least one resolved outcome horizon. */
    withOutcomes: number;
    pending: number;
    /** Distribution of component_count (0..5). */
    componentHistogram: number[];
    avgSetupScore: number | null;
    firstCandidateAt: string | null;
    lastCandidateAt: string | null;
    /** Distinct London capture days present in the window. */
    captureDays: number;
    providers: Record<string, number>;
    raidStates: Record<string, number>;
    /** Median of each frozen feature over the window (audit only). */
    featureMedians: Record<string, number | null>;
    horizons: HorizonStats[];
  };
  /** Research snapshot computed over ALL filtered rows (not just `rows`). */
  dataset: PreRaidDatasetContext;
}

/** Safety cap for the aggregate scan (lightweight columns only). */
const DATASET_SCAN_CAP = 20_000;
const DATASET_PAGE = 1000;

const FEATURE_COLUMN: Readonly<Record<string, string>> = {
  dist_relevant_local_liq_atr: "dist_liquidity",
  micro_hhhl_score_5: "micro_pullback",
  minutes_since_relevant_raid_norm: "minutes_since_relevant_raid_norm",
  position_in_asia_range_dir: "asia_position",
  approach_velocity_liq_3m_atr: "approach_velocity",
};

const DATASET_COLUMNS =
  "candidate_at,direction,component_count,provider,dist_liquidity,micro_pullback," +
  "minutes_since_relevant_raid_norm,asia_position,approach_velocity";

type DatasetRow = {
  candidate_at: string;
  direction: "long" | "short";
  component_count: number;
  provider: string | null;
  dist_liquidity: number | null;
  micro_pullback: number | null;
  minutes_since_relevant_raid_norm: number | null;
  asia_position: number | null;
  approach_velocity: number | null;
};

type SideAccumulator = {
  count: number;
  sum: number;
  fullHouse: number;
  histogram: number[];
  passes: Record<string, number>;
  seen: Record<string, number>;
};

function newSide(): SideAccumulator {
  const passes: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const name of PRE_RAID_FEATURE_NAMES) {
    passes[name] = 0;
    seen[name] = 0;
  }
  return { count: 0, sum: 0, fullHouse: 0, histogram: [0, 0, 0, 0, 0, 0], passes, seen };
}

function sideOut(acc: SideAccumulator): PreRaidDatasetContext["long"] {
  const featurePassRate: Record<string, number | null> = {};
  for (const name of PRE_RAID_FEATURE_NAMES) {
    featurePassRate[name] = acc.seen[name] ? acc.passes[name] / acc.seen[name] : null;
  }
  return {
    count: acc.count,
    avgComponentCount: acc.count ? acc.sum / acc.count : null,
    fullHouse: acc.fullHouse,
    fullHouseRate: acc.count ? acc.fullHouse / acc.count : null,
    featurePassRate,
    componentHistogram: acc.histogram,
  };
}

/**
 * Aggregate the full filtered dataset server-side. Only small scalar columns
 * are read (never the JSON blobs), paginated in pages of `DATASET_PAGE`.
 * Pass/fail is re-derived with the FROZEN medians and signs — never re-fit.
 */
async function readDatasetContext(
  supabase: SupabaseClient<Database>,
  input: { symbol: string; since: string; direction?: "long" | "short" | "all" },
): Promise<PreRaidDatasetContext> {
  const base = () => {
    let q = supabase
      .from("pre_raid_observations")
      .select(DATASET_COLUMNS)
      .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
      .eq("symbol", input.symbol)
      .gte("candidate_at", input.since);
    if (input.direction && input.direction !== "all") q = q.eq("direction", input.direction);
    return q;
  };

  const all: DatasetRow[] = [];
  let truncated = false;
  for (let from = 0; from < DATASET_SCAN_CAP; from += DATASET_PAGE) {
    const { data, error } = await base()
      .order("candidate_at", { ascending: false })
      .range(from, from + DATASET_PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as DatasetRow[];
    all.push(...page);
    if (page.length < DATASET_PAGE) break;
    if (from + DATASET_PAGE >= DATASET_SCAN_CAP) truncated = true;
  }

  const minutes = new Map<string, { long: boolean; short: boolean }>();
  const days = new Set<string>();
  const providers: Record<string, number> = {};
  const histogram = [0, 0, 0, 0, 0, 0];
  const long = newSide();
  const short = newSide();

  for (const row of all) {
    const side = row.direction === "long" ? long : short;
    const bucket = Math.max(0, Math.min(5, Math.round(row.component_count)));
    histogram[bucket]++;
    side.histogram[bucket]++;
    side.count++;
    side.sum += bucket;
    if (bucket === 5) side.fullHouse++;
    for (const name of PRE_RAID_FEATURE_NAMES) {
      const value = num((row as unknown as Record<string, unknown>)[FEATURE_COLUMN[name]]);
      if (value === null) continue;
      side.seen[name]++;
      if ((value - PRE_RAID_TRAIN_MEDIANS[name]) * PRE_RAID_TRAIN_SIGNS[name] > 0) {
        side.passes[name]++;
      }
    }
    if (row.provider) providers[row.provider] = (providers[row.provider] ?? 0) + 1;
    days.add(row.candidate_at.slice(0, 10));
    const key = row.candidate_at;
    const slot = minutes.get(key) ?? { long: false, short: false };
    if (row.direction === "long") slot.long = true;
    else slot.short = true;
    minutes.set(key, slot);
  }

  const outcomeMaturity = await Promise.all(
    PRE_RAID_HORIZONS.map(async (horizon) => {
      const column = `outcome_${horizon}m` as const;
      let q = supabase
        .from("pre_raid_observations")
        .select("id", { count: "exact", head: true })
        .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
        .eq("symbol", input.symbol)
        .gte("candidate_at", input.since)
        .not(column, "is", null);
      if (input.direction && input.direction !== "all") q = q.eq("direction", input.direction);
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return { horizon, resolved: count ?? 0, total: all.length };
    }),
  );

  return {
    totalObservations: all.length,
    truncated,
    uniqueCandidateMinutes: minutes.size,
    pairedMinutes: [...minutes.values()].filter((m) => m.long && m.short).length,
    captureDays: days.size,
    componentHistogram: histogram,
    long: sideOut(long),
    short: sideOut(short),
    providers,
    outcomeMaturity,
    noCalibration: outcomeMaturity.every((h) => h.resolved < 30),
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function outcomeOf(row: PreRaidAuditRow, horizon: number): Record<string, unknown> | null {
  const raw =
    horizon === 1
      ? row.outcome_1m
      : horizon === 3
        ? row.outcome_3m
        : horizon === 5
          ? row.outcome_5m
          : row.outcome_15m;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

const SELECT_COLUMNS =
  "id,candidate_at,direction,reference_price,atr_m5,setup_score,component_count," +
  "dist_liquidity,approach_velocity,micro_pullback,asia_position,raid_state," +
  "minutes_since_relevant_raid_norm,provider,source_last_closed_at,components,features," +
  "london_context,outcome_1m,outcome_3m,outcome_5m,outcome_15m,outcomes_updated_at,created_at";

export async function readPreRaidAudit(
  supabase: SupabaseClient<Database>,
  input: { symbol: string; days: number; direction?: "long" | "short" | "all"; limit: number },
): Promise<PreRaidAuditResult> {
  const asOf = Math.floor(Date.now() / 1000);
  const since = new Date((asOf - input.days * 86_400) * 1000).toISOString();

  let query = supabase
    .from("pre_raid_observations")
    .select(SELECT_COLUMNS)
    .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
    .eq("symbol", input.symbol)
    .gte("candidate_at", since)
    .order("candidate_at", { ascending: false })
    .limit(Math.min(input.limit, 1000));

  if (input.direction && input.direction !== "all") {
    query = query.eq("direction", input.direction);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PreRaidAuditRow[];

  const componentHistogram = [0, 0, 0, 0, 0, 0];
  const providers: Record<string, number> = {};
  const raidStates: Record<string, number> = {};
  const days = new Set<string>();
  const featureValues: Record<string, number[]> = {};
  for (const name of PRE_RAID_FEATURE_NAMES) featureValues[name] = [];

  let long = 0;
  let short = 0;
  let withOutcomes = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const row of rows) {
    if (row.direction === "long") long++;
    else short++;
    const bucket = Math.max(0, Math.min(5, Math.round(row.component_count)));
    componentHistogram[bucket]++;
    if (row.provider) providers[row.provider] = (providers[row.provider] ?? 0) + 1;
    if (row.raid_state) raidStates[row.raid_state] = (raidStates[row.raid_state] ?? 0) + 1;
    days.add(row.candidate_at.slice(0, 10));
    const score = num(row.setup_score);
    if (score !== null) {
      scoreSum += score;
      scoreCount++;
    }
    if (PRE_RAID_HORIZONS.some((h) => outcomeOf(row, h) !== null)) withOutcomes++;

    const features =
      row.features && typeof row.features === "object" && !Array.isArray(row.features)
        ? (row.features as Record<string, unknown>)
        : {};
    for (const name of PRE_RAID_FEATURE_NAMES) {
      const v = num(features[name]);
      if (v !== null) featureValues[name].push(v);
    }
  }

  const horizons: HorizonStats[] = PRE_RAID_HORIZONS.map((horizon) => {
    let resolved = 0;
    let displacement = 0;
    const mfe: number[] = [];
    const mae: number[] = [];
    for (const row of rows) {
      const o = outcomeOf(row, horizon);
      if (!o) continue;
      resolved++;
      if (o["displacement_1atr"] === true) displacement++;
      const m = num(o["mfe_atr"]);
      const a = num(o["mae_atr"]);
      if (m !== null) mfe.push(m);
      if (a !== null) mae.push(a);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    return {
      horizon,
      resolved,
      displacement,
      displacementRate: resolved ? displacement / resolved : null,
      avgMfeAtr: avg(mfe),
      avgMaeAtr: avg(mae),
    };
  });

  const featureMedians: Record<string, number | null> = {};
  for (const name of PRE_RAID_FEATURE_NAMES) featureMedians[name] = median(featureValues[name]);

  return {
    detectorVersion: PRE_RAID_DETECTOR_VERSION,
    symbol: input.symbol,
    days: input.days,
    window: preRaidWindowStatus(asOf),
    asOf,
    rows,
    featureNames: PRE_RAID_FEATURE_NAMES,
    summary: {
      total: rows.length,
      long,
      short,
      withOutcomes,
      pending: rows.length - withOutcomes,
      componentHistogram,
      avgSetupScore: scoreCount ? scoreSum / scoreCount : null,
      firstCandidateAt: rows.length ? rows[rows.length - 1].candidate_at : null,
      lastCandidateAt: rows.length ? rows[0].candidate_at : null,
      captureDays: days.size,
      providers,
      raidStates,
      featureMedians,
      horizons,
    },
  };
}
