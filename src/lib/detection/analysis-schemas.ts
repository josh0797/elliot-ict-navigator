/** Client-safe zod input schemas for the analysis server functions. */
import { z } from "zod";
import { CandleSchema } from "@/lib/marketData/schemas";

export const AnalyzeInput = z.object({
  symbol: z.string().min(2),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(5000).default(500),
  /** Elliott degree for the primary count. `undefined` = auto by timeframe. */
  degree: z.enum(["MAJOR", "INTERMEDIATE", "MINOR"]).optional(),
  /** Reuse candles already fetched by the client (avoids a duplicate call). */
  candles: z.array(CandleSchema).optional(),
  /** Skip the higher-timeframe macro count for a faster first paint. */
  includeMacro: z.boolean().default(true),
  /** Shared snapshot timestamp (UTC seconds). */
  asOf: z.number().int().positive().optional(),
  /** When true the caller already knows the series is stale: block analysis. */
  dataStale: z.boolean().default(false),
});

export const SetupsInput = z.object({
  symbol: z.string().min(2),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(5000).default(500),
  topN: z.number().int().min(1).max(10).default(3),
  /** Exact OHLC snapshot the chart is rendering. */
  candles: z.array(CandleSchema).optional(),
  /** Caller-known staleness: blocks any new signal. */
  dataStale: z.boolean().default(false),
});

export type AnalyzeInputData = z.infer<typeof AnalyzeInput>;
export type SetupsInputData = z.infer<typeof SetupsInput>;
