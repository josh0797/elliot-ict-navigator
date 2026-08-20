/**
 * Diagnostic read path for PRE_RAID_APPROACH_V1 observations.
 * Runs as the signed-in user (RLS SELECT) — no service role involved.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { PRE_RAID_DETECTOR_VERSION } from "./pre-raid";
import { preRaidWindowStatus } from "./pre-raid.server";

export interface PreRaidLatestRow {
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
  outcome_1m: Json;
  outcome_3m: Json;
  outcome_5m: Json;
  outcome_15m: Json;
}

export interface PreRaidLatestResult {
  detectorVersion: string;
  label: string;
  symbol: string;
  window: ReturnType<typeof preRaidWindowStatus>;
  long: PreRaidLatestRow | null;
  short: PreRaidLatestRow | null;
  /** Server clock at read time (unix seconds) for freshness display. */
  asOf: number;
}

export async function readLatestPreRaid(
  supabase: SupabaseClient<Database>,
  symbol: string,
): Promise<PreRaidLatestResult> {
  const base = {
    detectorVersion: PRE_RAID_DETECTOR_VERSION,
    label: "SONIC-likeness (diagnostic, not a win probability)",
    symbol,
    window: preRaidWindowStatus(),
    asOf: Math.floor(Date.now() / 1000),
  };

  const pick = async (direction: "long" | "short") => {
    const { data } = await supabase
      .from("pre_raid_observations")
      .select(
        "id,candidate_at,direction,reference_price,atr_m5,setup_score,component_count,dist_liquidity,approach_velocity,micro_pullback,asia_position,raid_state,minutes_since_relevant_raid_norm,provider,source_last_closed_at,components,outcome_1m,outcome_3m,outcome_5m,outcome_15m",
      )
      .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
      .eq("symbol", symbol)
      .eq("direction", direction)
      .order("candidate_at", { ascending: false })
      .limit(1);
    return (data?.[0] as unknown as PreRaidLatestRow | undefined) ?? null;
  };

  const [long, short] = await Promise.all([pick("long"), pick("short")]);
  return { ...base, long, short };
}
