import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchOhlcv, type MarketProvider } from "./marketData.functions";
import { liftCandles } from "./detection/schemas/analysis";
import { detectPivots } from "./detection/structure/pivots";
import { currentBias } from "./detection/structure/market-structure";
import { analyzeElliott } from "./detection/elliott/engine";
import { analyzeElliottDegrees } from "./detection/elliott/engine";
import { autoDegree, lowerDegree, type ElliottDegree } from "./detection/elliott/degrees";
import { analyzeIct } from "./detection/ict/engine";
import { toElliottResult } from "./detection/elliott/dto";
import { scenarioConsistencyCheck } from "./detection/consistency/scenario";
import type { ElliottResultDTO } from "./detection/elliott/types";
import type { IctContext } from "./detection/ict/types";
import type { Candle } from "./twelvedata.functions";

const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});

const Input = z.object({
  symbol: z.string().min(2),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(5000).default(500),
  /** Elliott degree to use for the primary count. `undefined` = auto by timeframe. */
  degree: z.enum(["MAJOR", "INTERMEDIATE", "MINOR"]).optional(),
  /** Reuse candles already fetched by the client (avoids a duplicate provider call). */
  candles: z.array(CandleSchema).optional(),
  /** Skip the higher-timeframe macro count for a faster first paint. */
  includeMacro: z.boolean().default(true),
});

export interface AnalyzeResponse {
  /**
   * Count computed on the DISPLAYED timeframe. Its wave indices/times map
   * 1:1 to the candles the chart renders, so it can always be drawn.
   */
  elliott: ElliottResultDTO;
  /** All detected degrees on the displayed timeframe. */
  degrees: Record<ElliottDegree, ElliottResultDTO>;
  /** Degree chosen for `elliott`. */
  degree: ElliottDegree;
  /** Diagnostics for the count horizon. */
  horizon?: { candles: number; pivots: number; pivotsUsed: number };
  /** Macro count on the higher timeframe (context / bias). */
  macro: ElliottResultDTO | null;
  ict: IctContext | null;
  provider?: MarketProvider;
  error?: string;
  /** Timeframe the macro count ran on. */
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
    nextWave: null,
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
    const htfInterval = data.includeMacro ? HTF_MAP[data.interval] : undefined;
    const reqBase = { symbol: data.symbol, interval: data.interval, outputsize: data.outputsize };
    const [ltfRes, htfRes] = await Promise.all([
      data.candles && data.candles.length > 0
        ? Promise.resolve({ candles: data.candles as Candle[], provider: "none" as const, error: undefined })
        : fetchOhlcv({ data: reqBase }),
      htfInterval
        ? fetchOhlcv({ data: { ...reqBase, interval: htfInterval, outputsize: 300 } })
        : Promise.resolve(null),
    ]);
    const { candles, provider, error } = ltfRes;
    const emptyDegrees = (): Record<ElliottDegree, ElliottResultDTO> => ({
      MAJOR: emptyElliott(), INTERMEDIATE: emptyElliott(), MINOR: emptyElliott(),
    });
    if (error || candles.length === 0) {
      return {
        elliott: emptyElliott(), degrees: emptyDegrees(), degree: "INTERMEDIATE",
        macro: null, ict: null, provider,
        error: error ?? "No candles",
        executionTimeframe: data.interval,
        countTimeframe: data.interval,
      };
    }
    const ltfLifted = liftCandles(candles);
    const ltfPivots = detectPivots(ltfLifted);
    const ict = analyzeIct(ltfLifted, ltfPivots, { timeframe: data.interval });
    const currentPrice = ltfLifted[ltfLifted.length - 1].close;
    const consistencyCtx = { currentPrice, candles: ltfLifted, ict };

    // Multi-degree count on the displayed timeframe — this is what gets drawn.
    const localBias = currentBias(ltfPivots);
    const analyses = analyzeElliottDegrees(ltfPivots);
    const degrees = {
      MAJOR: toElliottResult(analyses.MAJOR, localBias),
      INTERMEDIATE: toElliottResult(analyses.INTERMEDIATE, localBias),
      MINOR: toElliottResult(analyses.MINOR, localBias),
    } satisfies Record<ElliottDegree, ElliottResultDTO>;
    for (const [deg, dto] of Object.entries(degrees) as [ElliottDegree, ElliottResultDTO][]) {
      dto.timeframe = data.interval;
      dto.degree = deg;
      for (const alt of dto.alternatives) { alt.timeframe = data.interval; alt.degree = deg; }
      if (dto.status === "NO_COUNT" && deg === "MAJOR") {
        dto.scenario = "NO_VALID_MAJOR_COUNT — no valid higher-degree sequence; lower degrees still searched.";
      }
    }
    const chosen = data.degree ?? autoDegree(data.interval);
    // Fall back to the next lower degree when the chosen one has no count.
    const order: ElliottDegree[] = [chosen, ...(lowerDegree(chosen) ? [lowerDegree(chosen)!] : []), "MINOR"];
    const effective = order.find((d) => degrees[d].status !== "NO_COUNT") ?? chosen;
    let local: ElliottResultDTO = { ...degrees[effective] };
    const sub = lowerDegree(effective);
    local.internal = sub && degrees[sub].status !== "NO_COUNT" ? degrees[sub] : null;

    // ── Central coherence rule: reconcile count state, Fibonacci targets and
    // invalidation against the live price BEFORE the DTO is rendered.
    local = scenarioConsistencyCheck(local, consistencyCtx).scenario;
    for (const deg of Object.keys(degrees) as ElliottDegree[]) {
      degrees[deg] = scenarioConsistencyCheck(degrees[deg], consistencyCtx).scenario;
    }

    // Macro count on the higher timeframe (context only).
    let macro: ElliottResultDTO | null = null;
    let countTf = data.interval;
    if (htfRes && !htfRes.error && htfRes.candles.length > 0) {
      const htfLifted = liftCandles(htfRes.candles);
      const htfPivots = detectPivots(htfLifted);
      macro = toElliottResult(analyzeElliott(htfPivots, { degree: "MAJOR" }), currentBias(htfPivots));
      countTf = htfInterval!;
      macro.timeframe = countTf;
      macro = scenarioConsistencyCheck(macro, {
        currentPrice,
        candles: htfLifted,
        ict: null,
      }).scenario;
    }
    return {
      elliott: local,
      degrees,
      degree: effective,
      horizon: {
        candles: candles.length,
        pivots: ltfPivots.length,
        pivotsUsed: analyses[effective].pivotsUsed ?? 0,
      },
      macro,
      ict,
      provider,
      countTimeframe: countTf,
      executionTimeframe: data.interval,
    };
  });
