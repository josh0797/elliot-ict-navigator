/**
 * PRE_RAID_APPROACH_V1 diagnostic read endpoint — thin wrapper.
 * Runtime logic lives in `./ml/smc/pre-raid-read.server`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PreRaidLatestResult } from "./ml/smc/pre-raid-read.server";
import type { PreRaidAuditResult } from "./ml/smc/pre-raid-audit.server";
import type { PreRaidExportResult } from "./ml/smc/pre-raid-export.server";


export type { PreRaidLatestResult, PreRaidLatestRow } from "./ml/smc/pre-raid-read.server";
export type {
  PreRaidAuditResult,
  PreRaidAuditRow,
  HorizonStats,
} from "./ml/smc/pre-raid-audit.server";

const Input = z.object({ symbol: z.string().default("XAU/USD") });

export const getLatestPreRaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PreRaidLatestResult> => {
    const { readLatestPreRaid } = await import("./ml/smc/pre-raid-read.server");
    return readLatestPreRaid(context.supabase, data.symbol);
  });

const AuditInput = z.object({
  symbol: z.string().default("XAU/USD"),
  days: z.coerce.number().int().min(1).max(365).default(30),
  direction: z.enum(["all", "long", "short"]).default("all"),
  limit: z.coerce.number().int().min(10).max(1000).default(200),
});

/** SONIC AUDIT — read-only observability over captured observations. */
export const getPreRaidAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AuditInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PreRaidAuditResult> => {
    const { readPreRaidAudit } = await import("./ml/smc/pre-raid-audit.server");
    return readPreRaidAudit(context.supabase, data);
  });

const ExportInput = z.object({
  symbol: z.string().default("XAU/USD"),
  days: z.coerce.number().int().min(1).max(365).default(30),
  direction: z.enum(["all", "long", "short"]).default("all"),
});

/** SONIC AUDIT — FULL CSV export (server-paginated, all matching rows). */
export const exportPreRaidAuditCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExportInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PreRaidExportResult> => {
    const { exportPreRaidCsv } = await import("./ml/smc/pre-raid-export.server");
    return exportPreRaidCsv(context.supabase, data);
  });

