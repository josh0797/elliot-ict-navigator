/**
 * Elliott / ICT / setup pipelines — SERVER ONLY.
 *
 * These are plain async functions (never `createServerFn`) so the server-fn
 * split transform cannot strip them, and so no server function ever calls
 * another server function (which corrupts the RPC manifest in production).
 */
import { loadOhlcv } from "@/lib/marketData/providers.server";
import type { Candle } from "@/lib/marketData/types";
import { liftCandles } from "./schemas/analysis";
import { detectPivots } from "./structure/pivots";
import { currentBias } from "./structure/market-structure";
import { analyzeElliott, analyzeElliottDegrees } from "./elliott/engine";
import { autoDegree, lowerDegree, type ElliottDegree } from "./elliott/degrees";
import { analyzeIct } from "./ict/engine";
import { toElliottResult } from "./elliott/dto";
import { scenarioConsistencyCheck } from "./consistency/scenario";
import { detectSignals } from "./setup/engine";
import { decideOperation } from "./decision/engine";
import { detectEndingDiagonal } from "./elliott/diagonal";
import { closedCandlesAsOf, contextTimeframeFor, macroScenarioId } from "./mtf";
import type { ElliottResultDTO } from "./elliott/types";
import type { DetectSetupsResult } from "./setup/types";
import type { DecisionReasonCode, OperationalReport } from "./decision/types";
import type { AnalyzeResponse } from "./analysis-types";
import type { AnalyzeInputData, SetupsInputData } from "./analysis-schemas";

export function emptyElliott(): ElliottResultDTO {
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

function emptyDegrees(): Record<ElliottDegree, ElliottResultDTO> {
  return {
    MAJOR: emptyElliott(),
    INTERMEDIATE: emptyElliott(),
    MINOR: emptyElliott(),
  };
}

function noDataDecision(stale: boolean): OperationalReport {
  return {
    decision: "NO_TRADE" as const,
    status: "NO_SETUP" as const,
    template: "NO_VALID_TEMPLATE" as const,
    direction: "NEUTRAL" as const,
    bias: {
      dominant: "NEUTRAL" as const,
      bullScore: 0,
      bearScore: 0,
      conflict: false,
      votes: [],
    },
    primarySignal: null,
    reasons: stale
      ? (["DATA_STALE"] as DecisionReasonCode[])
      : (["NO_PRIMARY_COUNT"] as DecisionReasonCode[]),
    summary: stale ? "NO TRADE — datos obsoletos (DATA_STALE)." : "NO TRADE — sin datos.",
    missing: [],
  };
}

export async function runAnalyzeSymbol(data: AnalyzeInputData): Promise<AnalyzeResponse> {
  const asOf = data.asOf ?? Math.floor(Date.now() / 1000);
  const htfInterval = data.includeMacro ? contextTimeframeFor(data.interval) : undefined;
  const reqBase = { symbol: data.symbol, interval: data.interval, outputsize: data.outputsize };

  // Stale series must never produce a new count.
  if (data.dataStale) {
    return {
      elliott: emptyElliott(),
      degrees: emptyDegrees(),
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
          error: undefined as string | undefined,
        })
      : loadOhlcv(reqBase),
    htfInterval ? loadOhlcv({ ...reqBase, interval: htfInterval, outputsize: 300 }) : null,
  ]);
  const { candles, provider, error } = ltfRes;
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
  const order: ElliottDegree[] = [
    chosen,
    ...(lowerDegree(chosen) ? [lowerDegree(chosen)!] : []),
    "MINOR",
  ];
  const effective = order.find((d) => degrees[d].status !== "NO_COUNT") ?? chosen;
  let local: ElliottResultDTO = { ...degrees[effective] };
  const sub = lowerDegree(effective);
  local.internal = sub && degrees[sub].status !== "NO_COUNT" ? degrees[sub] : null;

  // Central coherence rule: reconcile count state, Fibonacci targets and
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
    // Only candles CLOSED at `asOf` may shape the macro scenario.
    const htfClosed = closedCandlesAsOf(htfRes.candles, htfInterval!, asOf);
    const htfLifted = liftCandles(htfClosed.length >= 20 ? htfClosed : htfRes.candles);
    const htfPivots = detectPivots(htfLifted);
    macro = toElliottResult(analyzeElliott(htfPivots, { degree: "MAJOR" }), currentBias(htfPivots));
    countTf = htfInterval!;
    macro.timeframe = countTf;
    const htfPrice = htfLifted[htfLifted.length - 1].close;
    macro = scenarioConsistencyCheck(macro, {
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
}

export async function runDetectSetups(data: SetupsInputData): Promise<DetectSetupsResult> {
  const snapshot = data.candles?.length
    ? {
        candles: data.candles as Candle[],
        provider: "none" as const,
        meta: undefined,
        error: undefined as string | undefined,
        status: (data.dataStale ? "DATA_STALE" : "OK") as "OK" | "DATA_STALE",
      }
    : await loadOhlcv({
        symbol: data.symbol,
        interval: data.interval,
        outputsize: data.outputsize,
      });
  const { candles, provider, error } = snapshot;
  const meta = snapshot.meta ?? null;
  if (error || candles.length === 0 || snapshot.status === "DATA_STALE") {
    const stale = snapshot.status === "DATA_STALE";
    return {
      symbol: data.symbol,
      timeframe: data.interval,
      signals: [],
      elliott: emptyElliott(),
      decision: noDataDecision(stale),
      provider,
      error: error ?? (stale ? "DATA_STALE" : "No candles"),
    };
  }

  const lifted = liftCandles(candles);
  const pivots = detectPivots(lifted);
  const bias = currentBias(pivots);
  const analysis = analyzeElliott(pivots);
  const ict = analyzeIct(lifted, pivots, { timeframe: data.interval });
  const diagonal = detectEndingDiagonal(pivots, lifted);
  const signals = detectSignals(lifted, pivots, analysis, ict, {
    symbol: data.symbol,
    timeframe: data.interval,
    topN: data.topN,
    diagonalBreakout: diagonal?.brokenOut === true,
    dataStale: meta?.stale === true,
  });
  const currentPrice = lifted[lifted.length - 1].close;
  const check = scenarioConsistencyCheck(toElliottResult(analysis, bias), {
    currentPrice,
    candles: lifted,
    ict,
  });
  const decision = decideOperation(analysis, ict, signals, lifted.length, diagonal, {
    primaryRetired: check.primaryRetired,
  });
  return {
    symbol: data.symbol,
    timeframe: data.interval,
    signals,
    elliott: check.scenario,
    decision,
    diagonal,
    provider,
    meta,
  };
}

/**
 * Multi-timeframe pipeline:
 *   • Elliott count runs on the context timeframe.
 *   • ICT (sweeps, structure, POIs) and setup detection run on the LTF.
 */
export async function runDetectSetupsMTF(
  data: SetupsInputData,
): Promise<DetectSetupsResult & { htf: string }> {
  const htfInterval = contextTimeframeFor(data.interval);

  const [htfRes, ltfRes] = await Promise.all([
    loadOhlcv({ symbol: data.symbol, interval: htfInterval, outputsize: 300 }),
    data.candles?.length
      ? Promise.resolve({
          candles: data.candles as Candle[],
          provider: "none" as const,
          meta: undefined,
          error: undefined as string | undefined,
          status: (data.dataStale ? "DATA_STALE" : "OK") as "OK" | "DATA_STALE",
        })
      : loadOhlcv({
          symbol: data.symbol,
          interval: data.interval,
          outputsize: data.outputsize,
        }),
  ]);
  const ltfMeta = ltfRes.meta ?? null;
  const ltfError = ltfRes.error;
  const ltfStale = ltfRes.status === "DATA_STALE" || ltfMeta?.stale === true;
  if (ltfError || ltfRes.candles.length === 0 || ltfStale) {
    return {
      symbol: data.symbol,
      timeframe: data.interval,
      htf: htfInterval,
      signals: [],
      elliott: emptyElliott(),
      decision: noDataDecision(ltfStale === true),
      provider: ltfRes.provider,
      error: ltfError ?? (ltfStale ? "DATA_STALE" : "No candles"),
    };
  }

  const ltfLifted = liftCandles(ltfRes.candles);
  const ltfPivots = detectPivots(ltfLifted);
  const ict = analyzeIct(ltfLifted, ltfPivots, { timeframe: data.interval });
  // Diagonal detected on the execution timeframe where wedge + breakout live.
  const diagonal = detectEndingDiagonal(ltfPivots, ltfLifted);

  // HTF may fail independently — degrade gracefully to LTF-only Elliott.
  let analysis;
  let elliottBias;
  if (!htfRes.error && htfRes.candles.length > 0) {
    const htfLifted = liftCandles(htfRes.candles);
    const htfPivots = detectPivots(htfLifted);
    analysis = analyzeElliott(htfPivots);
    elliottBias = currentBias(htfPivots);
  } else {
    analysis = analyzeElliott(ltfPivots);
    elliottBias = currentBias(ltfPivots);
  }

  const signals = detectSignals(ltfLifted, ltfPivots, analysis, ict, {
    symbol: data.symbol,
    timeframe: data.interval,
    topN: data.topN,
    diagonalBreakout: diagonal?.brokenOut === true,
    dataStale: ltfMeta?.stale === true,
  });
  const currentPrice = ltfLifted[ltfLifted.length - 1].close;
  const check = scenarioConsistencyCheck(toElliottResult(analysis, elliottBias), {
    currentPrice,
    candles: ltfLifted,
    ict,
  });
  const decision = decideOperation(analysis, ict, signals, ltfLifted.length, diagonal, {
    primaryRetired: check.primaryRetired,
  });

  return {
    symbol: data.symbol,
    timeframe: data.interval,
    htf: htfInterval,
    signals,
    elliott: check.scenario,
    decision,
    diagonal,
    provider: ltfRes.provider,
    meta: ltfMeta,
  };
}
