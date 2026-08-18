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
import { closedCandlesAsOf, contextTimeframeFor, macroScenarioId } from "./detection/mtf";

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
  /** Shared snapshot timestamp (UTC seconds). Every timeframe aligns to it. */
  asOf: z.number().int().positive().optional(),
  /** When true the caller already knows the series is stale: block analysis. */
  dataStale: z.boolean().default(false),
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
  /** Stable macro scenario identity — equal for every execution timeframe
   *  sharing the same context timeframe and `asOf`. */
  macroScenarioId?: string | null;
  /** Snapshot timestamp actually used. */
  asOf?: number;
}

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
    const asOf = data.asOf ?? Math.floor(Date.now() / 1000);
    const htfInterval = data.includeMacro ? contextTimeframeFor(data.interval) : undefined;
    const reqBase = { symbol: data.symbol, interval: data.interval, outputsize: data.outputsize };
    const emptyDegreesOnly = (): Record<ElliottDegree, ElliottResultDTO> => ({
      MAJOR: emptyElliott(),
      INTERMEDIATE: emptyElliott(),
      MINOR: emptyElliott(),
    });
    // Stale series must never produce a new count.
    if (data.dataStale) {
      return {
        elliott: emptyElliott(),
        degrees: emptyDegreesOnly(),
        degree: "INTERMEDIATE",
        macro: null,
        ict: null,
        error: "DATA_STALE",
        executionTimeframe: data.interval,
        countTimeframe: htfInterval ?? data.interval,
        macroScenarioId: null,
        asOf,
      };
    }
    const [ltfRes, htfRes] = await Promise.all([
      data.candles && data.candles.length > 0
        ? Promise.resolve({
            candles: data.candles as Candle[],
            provider: "none" as const,
            error: undefined,
          })
        : fetchOhlcv({ data: reqBase }),
      htfInterval
        ? fetchOhlcv({ data: { ...reqBase, interval: htfInterval, outputsize: 300 } })
        : Promise.resolve(null),
    ]);
    const { candles, provider, error } = ltfRes;
    const emptyDegrees = emptyDegreesOnly;
    if (error || candles.length === 0) {
      return {
        elliott: emptyElliott(),
        degrees: emptyDegrees(),
        degree: "INTERMEDIATE",
        macro: null,
        ict: null,
        provider,
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
      for (const alt of dto.alternatives) {
        alt.timeframe = data.interval;
        alt.degree = deg;
      }
      if (dto.status === "NO_COUNT" && deg === "MAJOR") {
        dto.scenario =
          "NO_VALID_MAJOR_COUNT — no valid higher-degree sequence; lower degrees still searched.";
      }
    }
    const chosen = data.degree ?? autoDegree(data.interval);
    // Fall back to the next lower degree when the chosen one has no count.
    const order: ElliottDegree[] = [
      chosen,
      ...(lowerDegree(chosen) ? [lowerDegree(chosen)!] : []),
      "MINOR",
    ];
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
    let macroId: string | null = null;
    let countTf = data.interval;
    if (htfRes && !htfRes.error && htfRes.candles.length > 0) {
      // Only candles CLOSED at `asOf` may shape the macro scenario, so 1h and 4h
      // views of the same instant share the exact same context series.
      const htfClosed = closedCandlesAsOf(htfRes.candles, htfInterval!, asOf);
      const htfLifted = liftCandles(htfClosed.length >= 20 ? htfClosed : htfRes.candles);
      const htfPivots = detectPivots(htfLifted);
      macro = toElliottResult(
        analyzeElliott(htfPivots, { degree: "MAJOR" }),
        currentBias(htfPivots),
      );
      countTf = htfInterval!;
      macro.timeframe = countTf;
      const htfPrice = htfLifted[htfLifted.length - 1].close;
      macro = scenarioConsistencyCheck(macro, {
        // Context-timeframe facts only — never the execution timeframe price.
        currentPrice: htfPrice,
        candles: htfLifted,
        ict: null,
      }).scenario;
      macroId = macroScenarioId({
        symbol: data.symbol,
        contextTimeframe: countTf,
        asOf,
        pattern: macro.pattern,
        bias: macro.bias,
        anchors: macro.waves.map((w) => ({
          label: String(w.label),
          // Anchors are keyed by timestamp + price, never by array index.
          time: Math.floor(new Date(w.time).getTime() / 1000),
          price: w.price,
        })),
      });
      macro.scenarioId = macroId;
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
      macroScenarioId: macroId,
      asOf,
    };
  });
