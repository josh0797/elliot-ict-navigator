/**
 * PRE_RAID_APPROACH_V1 diagnostic read endpoint — thin wrapper.
 * Runtime logic lives in `./ml/smc/pre-raid-read.server`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PreRaidLatestResult } from "./ml/smc/pre-raid-read.server";

export type { PreRaidLatestResult, PreRaidLatestRow } from "./ml/smc/pre-raid-read.server";

const Input = z.object({ symbol: z.string().default("XAU/USD") });

export const getLatestPreRaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PreRaidLatestResult> => {
    const { readLatestPreRaid } = await import("./ml/smc/pre-raid-read.server");
    return readLatestPreRaid(context.supabase, data.symbol);
  });