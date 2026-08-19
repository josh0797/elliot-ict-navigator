/** Client-safe zod schemas shared by the market-data server functions. */
import { z } from "zod";

export const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});

export const OhlcvInput = z.object({
  symbol: z.string().min(3),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(5000).default(500),
});

export const TwelveDataInput = z.object({
  symbol: z.string().min(3),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(2000).default(500),
});
