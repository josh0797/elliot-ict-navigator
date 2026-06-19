import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCandles } from "./twelvedata.functions";
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
  error?: string;
}

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
    const { candles, error } = await fetchCandles({ data });
    if (error || candles.length === 0) {
      return { elliott: emptyElliott(), ict: null, error: error ?? "No candles" };
    }
    const lifted = liftCandles(candles);
    const pivots = detectPivots(lifted);
    const bias = currentBias(pivots);
    const analysis = analyzeElliott(pivots);
    const ict = analyzeIct(lifted, pivots);
    return { elliott: toElliottResult(analysis, bias), ict };
  });
