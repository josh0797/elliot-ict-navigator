/**
 * SONIC AUDIT — FULL CSV export of the PRE_RAID_APPROACH_V1 research capture.
 *
 * Read-only. Paginates `pre_raid_observations` under RLS as the signed-in user
 * until every row matching the active filters is retrieved (no invented rows,
 * no recomputation, no influence on detector / decisions / alerts / scoring).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PRE_RAID_DETECTOR_VERSION } from "./pre-raid";
import { buildCsv } from "@/lib/csv";

const PAGE_SIZE = 1000;
/** Hard safety ceiling so a runaway table cannot exhaust the worker. */
const MAX_ROWS = 100_000;

const EXPORT_COLUMNS = [
  "id",
  "detector_version",
  "symbol",
  "candidate_at",
  "direction",
  "reference_price",
  "atr_m5",
  "setup_score",
  "component_count",
  "dist_liquidity",
  "approach_velocity",
  "micro_pullback",
  "asia_position",
  "raid_state",
  "minutes_since_relevant_raid_norm",
  "provider",
  "source_last_closed_at",
  "created_at",
  "outcomes_updated_at",
  "components",
  "features",
  "london_context",
  "outcome_1m",
  "outcome_3m",
  "outcome_5m",
  "outcome_15m",
] as const;

export interface PreRaidExportInput {
  symbol: string;
  days: number;
  direction: "all" | "long" | "short";
}

export interface PreRaidExportResult {
  filename: string;
  csv: string;
  rowCount: number;
  /** True when MAX_ROWS clipped the export (never silently, surfaced in UI). */
  truncated: boolean;
  columns: readonly string[];
}

function safeSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "") || "SYMBOL";
}

export async function exportPreRaidCsv(
  supabase: SupabaseClient<Database>,
  input: PreRaidExportInput,
): Promise<PreRaidExportResult> {
  const asOf = Date.now();
  const since = new Date(asOf - input.days * 86_400_000).toISOString();

  const rows: Record<string, unknown>[] = [];
  let truncated = false;

  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    let query = supabase
      .from("pre_raid_observations")
      .select(EXPORT_COLUMNS.join(","))
      .eq("detector_version", PRE_RAID_DETECTOR_VERSION)
      .eq("symbol", input.symbol)
      .gte("candidate_at", since)
      .order("candidate_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (input.direction !== "all") query = query.eq("direction", input.direction);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      rows.length = MAX_ROWS;
      break;
    }
  }

  const csv = buildCsv(
    EXPORT_COLUMNS,
    rows.map((row) => EXPORT_COLUMNS.map((c) => row[c] ?? null)),
  );

  const stamp = new Date(asOf).toISOString().slice(0, 10);
  const filename = `sonic-pre-raid-${safeSymbol(input.symbol)}-${input.days}d-${input.direction}-${stamp}.csv`;

  return { filename, csv, rowCount: rows.length, truncated, columns: EXPORT_COLUMNS };
}
