/**
 * Twelve Data server functions — thin wrappers around
 * `./marketData/twelvedata.server` (no sibling runtime declarations).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TwelveDataInput } from "./marketData/schemas";
import { fetchTwelveDataCandles, fetchTwelveDataPrice } from "./marketData/twelvedata.server";
import type { Candle } from "./marketData/types";

export type { Candle } from "./marketData/types";

export const fetchCandles = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TwelveDataInput.parse(d))
  .handler(
    async ({ data }): Promise<{ candles: Candle[]; error?: string }> =>
      fetchTwelveDataCandles(data),
  );

/** Current spot price for a symbol (used to evaluate live setups). */
export const fetchPrice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ symbol: z.string() }).parse(d))
  .handler(
    async ({ data }): Promise<{ price: number | null; error?: string }> =>
      fetchTwelveDataPrice(data.symbol),
  );
