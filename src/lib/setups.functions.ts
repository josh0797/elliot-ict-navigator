import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchOhlcv } from "./marketData.functions";
import { liftCandles } from "./detection/schemas/analysis";
import { detectPivots } from "./detection/structure/pivots";
import { currentBias } from "./detection/structure/market-structure";
import { analyzeElliott } from "./detection/elliott/engine";
import { analyzeIct } from "./detection/ict/engine";
import { toElliottResult } from "./detection/elliott/dto";
import { detectSignals } from "./detection/setup/engine";
import type { DetectSetupsResult } from "./detection/setup/types";

const Input = z.object({
  symbol: z.string().min(2),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(2000).default(500),
  topN: z.number().int().min(1).max(10).default(3),
});

export const detectSetups = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<DetectSetupsResult> => {
    const { candles, provider, error } = await fetchOhlcv({ data });
    const emptyElliott = {
      status: "NO_COUNT" as const, bias: "NEUTRAL" as const, pattern: "IMPULSE" as const,
      currentWave: null, completion: 0, confidence: 0, invalidationLevel: null,
      rules: [], waves: [], alternatives: [],
    };
    if (error || candles.length === 0) {
      return {
        symbol: data.symbol, timeframe: data.interval,
        signals: [], elliott: emptyElliott, provider, error: error ?? "No candles",
      };
    }
    const lifted = liftCandles(candles);
    const pivots = detectPivots(lifted);
    const bias = currentBias(pivots);
    const analysis = analyzeElliott(pivots);
    const ict = analyzeIct(lifted, pivots, { timeframe: data.interval });
    const signals = detectSignals(lifted, pivots, analysis, ict, {
      symbol: data.symbol,
      timeframe: data.interval,
      topN: data.topN,
    });
    return {
      symbol: data.symbol,
      timeframe: data.interval,
      signals,
      elliott: toElliottResult(analysis, bias),
      provider,
    };
  });