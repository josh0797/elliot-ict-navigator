/**
 * Prospective capture + outcome evaluation for PRE_RAID_APPROACH_V1.
 *
 * SERVER ONLY. Diagnostic research pipeline — piggybacks the existing 5-min
 * scanner and 10-min evaluator hooks. Every entry point is fail-open: callers
 * wrap these in try/catch and normal scanning / alerting / result evaluation
 * must never change because of anything in here.
 */
import { loadOhlcv } from "@/lib/marketData/providers.server";
import type { Json } from "@/integrations/supabase/types";
import { londonClock } from "./clock";
import {
  inPreRaidWindow,
  PRE_RAID_DETECTOR_VERSION,
  scorePreRaidApproach,
  type PreRaidObservation,
} from "./pre-raid";
import { computePreRaidOutcome, PRE_RAID_HORIZONS } from "./pre-raid-outcomes";
import type { CandidateDirection } from "./types";

const MIN = 60;
export const PRE_RAID_SYMBOL = "XAU/USD";
/** Enough M1 history for Asia range (from 00:00 London) + 60m window + M5 ATR. */
const M1_BARS = 900;
/** Catch-up cap: never backfill beyond the current validated London session. */
const MAX_CATCHUP_MINUTES = 130;
const MAX_EVAL_ROWS = 120;

export interface PreRaidCaptureReport {
  detector: string;
  status:
    | "captured"
    | "window_inactive"
    | "no_candidates"
    | "data_unavailable"
    | "data_stale"
    | "error";
  candidates: number;
  written: number;
  skipped: number;
  provider?: string;
  lastClosedM1At?: string | null;
  reasons?: Record<string, number>;
  error?: string;
}

export interface PreRaidEvaluationReport {
  detector: string;
  status: "evaluated" | "nothing_pending" | "data_unavailable" | "error";
  scanned: number;
  updated: number;
  horizonsFilled: number;
  error?: string;
}

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function floorMinute(sec: number): number {
  return Math.floor(sec / MIN) * MIN;
}

/** Candidate minutes = every fully closed minute boundary inside the window. */
export function candidateMinutes(input: {
  nowSeconds: number;
  lastStoredAt: number | null;
  lastClosedM1At: number;
}): number[] {
  // A candidate minute `t` needs the bar that closed at `t` (open t-60).
  const newest = input.lastClosedM1At + MIN;
  // Exclusive lower bound: strictly newer than the stored cursor, and never
  // older than the safe catch-up horizon (current validated London session).
  const floor = Math.max(
    floorMinute(input.nowSeconds) - MAX_CATCHUP_MINUTES * MIN,
    input.lastStoredAt ?? 0,
  );
  const out: number[] = [];
  for (let t = newest; t > floor && out.length < MAX_CATCHUP_MINUTES; t -= MIN) {
    if (inPreRaidWindow(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

function rowFor(obs: PreRaidObservation, provider: string, lastClosedM1At: number) {
  return {
    detector_version: obs.detectorVersion,
    symbol: obs.symbol,
    candidate_at: new Date(obs.candidateAt * 1000).toISOString(),
    direction: obs.direction,
    reference_price: obs.referencePrice,
    atr_m5: obs.atrM5,
    setup_score: obs.setupScore,
    component_count: obs.componentCount,
    dist_liquidity: obs.distLiquidity,
    approach_velocity: obs.approachVelocity,
    micro_pullback: obs.microPullback,
    asia_position: obs.asiaPosition,
    raid_state: obs.raidState,
    minutes_since_relevant_raid_norm: obs.minutesSinceRelevantRaidNorm,
    components: obs.components as unknown as Json,
    features: obs.features as unknown as Json,
    london_context: {
      localDate: obs.london.localDate,
      hour: obs.london.hour,
      minute: obs.london.minute,
      minuteOfDay: obs.london.minuteOfDay,
      session: obs.london.session,
      isDst: obs.london.isDst,
      utcOffsetMinutes: obs.london.utcOffsetMinutes,
      m30PhaseMinute: obs.m30PhaseMinute,
      relevantLevel: obs.relevantLevel,
      inValidatedWindow: obs.inValidatedWindow,
    } as unknown as Json,
    provider,
    source_last_closed_at: new Date(lastClosedM1At * 1000).toISOString(),
  };
}

/**
 * Capture prospective observations for every closed candidate minute inside the
 * validated London window. Records BOTH directions for every minute — no score
 * threshold, no outcome-based sampling, so controls/background are retained.
 */
export async function capturePreRaidObservations(
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<PreRaidCaptureReport> {
  const base: PreRaidCaptureReport = {
    detector: PRE_RAID_DETECTOR_VERSION,
    status: "window_inactive",
    candidates: 0,
    written: 0,
    skipped: 0,
  };
  // Cheap guard first: nothing to do outside the validated research window.
  if (!inPreRaidWindow(floorMinute(nowSeconds)) && !inPreRaidWindow(floorMinute(nowSeconds) - 5 * MIN)) {
    return base;
  }

  const snapshot = await loadOhlcv({ symbol: PRE_RAID_SYMBOL, interval: "1min", outputsize: M1_BARS });
  if (!snapshot.candles.length) {
    return { ...base, status: "data_unavailable", provider: snapshot.provider, error: snapshot.error };
  }
  if (snapshot.status !== "OK") {
    return {
      ...base,
      status: "data_stale",
      provider: snapshot.provider,
      lastClosedM1At: snapshot.meta ? snapshot.meta.lastCandleIso : null,
    };
  }
  const m1 = snapshot.candles;
  const lastClosedM1At = m1[m1.length - 1].time;

  const db = await admin();
  const { data: latest } = await db
    .from("pre_raid_observations")
    .select("candidate_at")
    .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
    .eq("symbol", PRE_RAID_SYMBOL)
    .order("candidate_at", { ascending: false })
    .limit(1);
  const lastStoredAt = latest?.[0]?.candidate_at
    ? Math.floor(new Date(latest[0].candidate_at).getTime() / 1000)
    : null;

  const minutes = candidateMinutes({ nowSeconds, lastStoredAt, lastClosedM1At });
  if (!minutes.length) {
    return { ...base, status: "no_candidates", provider: snapshot.provider };
  }

  const reasons: Record<string, number> = {};
  const rows: ReturnType<typeof rowFor>[] = [];
  let skipped = 0;
  for (const candidateAt of minutes) {
    for (const direction of ["long", "short"] as CandidateDirection[]) {
      const res = scorePreRaidApproach({ symbol: PRE_RAID_SYMBOL, candidateAt, direction, m1 });
      if (!res.ok) {
        skipped++;
        reasons[res.reason] = (reasons[res.reason] ?? 0) + 1;
        continue;
      }
      rows.push(rowFor(res, snapshot.provider, lastClosedM1At));
    }
  }

  let written = 0;
  if (rows.length) {
    const { data, error } = await db
      .from("pre_raid_observations")
      .upsert(rows, {
        onConflict: "detector_version,symbol,candidate_at,direction",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      return {
        ...base,
        status: "error",
        candidates: minutes.length,
        skipped,
        provider: snapshot.provider,
        error: error.message,
      };
    }
    written = data?.length ?? 0;
  }

  return {
    detector: PRE_RAID_DETECTOR_VERSION,
    status: "captured",
    candidates: minutes.length,
    written,
    skipped,
    provider: snapshot.provider,
    lastClosedM1At: new Date(lastClosedM1At * 1000).toISOString(),
    reasons: Object.keys(reasons).length ? reasons : undefined,
  };
}

/**
 * Fill missing +1/+3/+5/+15m research outcomes for recent observations.
 * A horizon is only written once all its CLOSED M1 bars exist, and an already
 * populated horizon is never recomputed.
 */
export async function evaluatePreRaidOutcomes(
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<PreRaidEvaluationReport> {
  const db = await admin();
  const since = new Date((nowSeconds - 36 * 3600) * 1000).toISOString();
  const readyBefore = new Date((nowSeconds - 16 * MIN) * 1000).toISOString();

  const { data: pending, error } = await db
    .from("pre_raid_observations")
    .select(
      "id,candidate_at,direction,reference_price,atr_m5,outcome_1m,outcome_3m,outcome_5m,outcome_15m",
    )
    .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
    .eq("symbol", PRE_RAID_SYMBOL)
    .gte("candidate_at", since)
    .lte("candidate_at", readyBefore)
    .is("outcome_15m", null)
    .order("candidate_at", { ascending: false })
    .limit(MAX_EVAL_ROWS);
  if (error) {
    return {
      detector: PRE_RAID_DETECTOR_VERSION,
      status: "error",
      scanned: 0,
      updated: 0,
      horizonsFilled: 0,
      error: error.message,
    };
  }
  if (!pending?.length) {
    return {
      detector: PRE_RAID_DETECTOR_VERSION,
      status: "nothing_pending",
      scanned: 0,
      updated: 0,
      horizonsFilled: 0,
    };
  }

  const snapshot = await loadOhlcv({ symbol: PRE_RAID_SYMBOL, interval: "1min", outputsize: 500 });
  if (!snapshot.candles.length) {
    return {
      detector: PRE_RAID_DETECTOR_VERSION,
      status: "data_unavailable",
      scanned: pending.length,
      updated: 0,
      horizonsFilled: 0,
      error: snapshot.error,
    };
  }
  const m1 = snapshot.candles;

  let updated = 0;
  let horizonsFilled = 0;
  for (const row of pending) {
    const candidateAt = Math.floor(new Date(row.candidate_at).getTime() / 1000);
    const patch: Record<string, unknown> = {};
    for (const horizon of PRE_RAID_HORIZONS) {
      const key = `outcome_${horizon}m` as "outcome_1m" | "outcome_3m" | "outcome_5m" | "outcome_15m";
      if (row[key] != null) continue; // idempotent — never recompute
      const outcome = computePreRaidOutcome({
        candidateAt,
        direction: row.direction === "short" ? "short" : "long",
        referencePrice: Number(row.reference_price),
        atrM5: Number(row.atr_m5),
        horizonMinutes: horizon,
        m1,
      });
      if (outcome) {
        patch[key] = outcome;
        horizonsFilled++;
      }
    }
    if (!Object.keys(patch).length) continue;
    patch["outcomes_updated_at"] = new Date(nowSeconds * 1000).toISOString();
    const { error: upErr } = await db
      .from("pre_raid_observations")
      .update(patch as never)
      .eq("id", row.id);
    if (!upErr) updated++;
  }

  return {
    detector: PRE_RAID_DETECTOR_VERSION,
    status: "evaluated",
    scanned: pending.length,
    updated,
    horizonsFilled,
  };
}

/** London window status for diagnostics/UI. */
export function preRaidWindowStatus(nowSeconds = Math.floor(Date.now() / 1000)) {
  const clock = londonClock(floorMinute(nowSeconds));
  return {
    active: inPreRaidWindow(floorMinute(nowSeconds)),
    londonLocal: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
    session: clock.session,
    window: "06:00–07:59 Europe/London (Mon–Fri)",
  };
}