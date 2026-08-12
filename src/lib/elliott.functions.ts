import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchOhlcv } from "./marketData.functions";
import { liftCandles } from "./detection/schemas/analysis";
import { detectPivots } from "./detection/structure/pivots";
import { currentBias } from "./detection/structure/market-structure";
import { analyzeElliott } from "./detection/elliott/engine";
import { analyzeIct } from "./detection/ict/engine";
import { toElliottResult } from "./detection/elliott/dto";
import type { ElliottResultDTO } from "./detection/elliott/types";
import type { IctContext } from "./detection/ict/types";

const Input = z.object({
  symbol: z.string().min(2),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(2000).default(500),
});

export interface AnalyzeResponse {
  elliott: ElliottResultDTO;
  ict: IctContext | null;
  provider?: MarketProvider;
  error?: string;
  /** Timeframe the Elliott count actually ran on (HTF when available). */
  countTimeframe?: string;
  /** Timeframe used for ICT + execution. */
  executionTimeframe?: string;
}

/**
 * LTF (execution / ICT) → HTF (macro Elliott count). Kept in sync with the
 * MTF pipeline in `setups.functions.ts`.
 */
const HTF_MAP: Record<string, string> = {
  "1m": "15min", "5min": "1h", "5m": "1h",
  "15min": "4h", "15m": "4h", "30min": "4h", "30m": "4h",
  "1h": "1day", "2h": "1day", "4h": "1day",
  "1day": "1week", "1d": "1week",
};

function emptyElliott(): ElliottResultDTO {
  return {
    status: "NO_COUNT",
    bias: "NEUTRAL",
    pattern: "IMPULSE",
    currentWave: null,
    completion: 0,
    confidence: 0,
    invalidationLevel: null,
    rules: [],
    waves: [],
    alternatives: [],
  };
}

export const analyzeSymbol = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<AnalyzeResponse> => {
    const htfInterval = HTF_MAP[data.interval];
    const [ltfRes, htfRes] = await Promise.all([
      fetchOhlcv({ data }),
      htfInterval
        ? fetchOhlcv({ data: { ...data, interval: htfInterval, outputsize: 300 } })
        : Promise.resolve(null),
    ]);
    const { candles, provider, error } = ltfRes;
    if (error || candles.length === 0) {
      return {
        elliott: emptyElliott(), ict: null, provider,
        error: error ?? "No candles",
        executionTimeframe: data.interval,
        countTimeframe: data.interval,
      };
    }
    const ltfLifted = liftCandles(candles);
    const ltfPivots = detectPivots(ltfLifted);
    const ict = analyzeIct(ltfLifted, ltfPivots, { timeframe: data.interval });

    // Prefer HTF pivots for the macro Elliott count; degrade to LTF if the
    // HTF fetch failed or returned nothing usable.
    let countPivots = ltfPivots;
    let countTf = data.interval;
    if (htfRes && !htfRes.error && htfRes.candles.length > 0) {
      countPivots = detectPivots(liftCandles(htfRes.candles));
      countTf = htfInterval!;
    }
    const analysis = analyzeElliott(countPivots);
    const bias = currentBias(countPivots);
    return {
      elliott: toElliottResult(analysis, bias),
      ict,
      provider,
      countTimeframe: countTf,
      executionTimeframe: data.interval,
    };
  });
