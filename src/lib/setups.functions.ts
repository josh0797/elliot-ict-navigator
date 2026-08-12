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
import { decideOperation } from "./detection/decision/engine";
import { detectEndingDiagonal } from "./detection/elliott/diagonal";

const Input = z.object({
  symbol: z.string().min(2),
  interval: z.string().default("1h"),
  outputsize: z.number().int().min(50).max(2000).default(500),
  topN: z.number().int().min(1).max(10).default(3),
});

/**
 * Multi-timeframe map: LTF (execution / ICT) → HTF (macro Elliott count).
 * Keys accept both raw provider strings and canonical alphabet — normalize
 * before lookup.
 */
const HTF_MAP: Record<string, string> = {
  "1m": "15min",
  "5min": "1h",
  "5m": "1h",
  "15min": "4h",
  "15m": "4h",
  "30min": "4h",
  "30m": "4h",
  "1h": "1day",
  "2h": "1day",
  "4h": "1day",
  "1day": "1week",
  "1d": "1week",
};

function emptyElliottDto() {
  return {
    status: "NO_COUNT" as const,
    bias: "NEUTRAL" as const,
    pattern: "IMPULSE" as const,
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

export const detectSetups = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<DetectSetupsResult> => {
    const { candles, provider, error } = await fetchOhlcv({ data });
    const emptyElliott = emptyElliottDto();
    if (error || candles.length === 0) {
      return {
        symbol: data.symbol, timeframe: data.interval,
        signals: [], elliott: emptyElliott,
        decision: {
          decision: "NO_TRADE",
          status: "NO_SETUP",
          template: "NO_VALID_TEMPLATE",
          direction: "NEUTRAL",
          bias: { dominant: "NEUTRAL", bullScore: 0, bearScore: 0, conflict: false, votes: [] },
          primarySignal: null,
          reasons: ["NO_PRIMARY_COUNT"],
          summary: "NO TRADE — sin datos.",
          missing: [],
        },
        provider, error: error ?? "No candles",
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
    });
    const decision = decideOperation(analysis, ict, signals, lifted.length, diagonal);
    return {
      symbol: data.symbol,
      timeframe: data.interval,
      signals,
      elliott: toElliottResult(analysis, bias),
      decision,
      diagonal,
      provider,
    };
  });

/**
 * Multi-timeframe pipeline:
 *   • Elliott count runs on the HTF derived from `HTF_MAP[interval]`.
 *   • ICT (sweeps, structure, POIs) and setup detection run on the LTF.
 *   • Signals inherit the macro Elliott context from the HTF.
 */
export const detectSetupsMTF = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<DetectSetupsResult & { htf: string }> => {
    const htfInterval = HTF_MAP[data.interval] ?? "1day";
    const emptyElliott = emptyElliottDto();

    const [htfRes, ltfRes] = await Promise.all([
      fetchOhlcv({ data: { ...data, interval: htfInterval, outputsize: 300 } }),
      fetchOhlcv({ data }),
    ]);

    const ltfError = ltfRes.error;
    if (ltfError || ltfRes.candles.length === 0) {
      return {
        symbol: data.symbol,
        timeframe: data.interval,
        htf: htfInterval,
        signals: [],
        elliott: emptyElliott,
        decision: {
          decision: "NO_TRADE",
          status: "NO_SETUP",
          template: "NO_VALID_TEMPLATE",
          direction: "NEUTRAL",
          bias: { dominant: "NEUTRAL", bullScore: 0, bearScore: 0, conflict: false, votes: [] },
          primarySignal: null,
          reasons: ["NO_PRIMARY_COUNT"],
          summary: "NO TRADE — sin datos.",
          missing: [],
        },
        provider: ltfRes.provider,
        error: ltfError ?? "No candles",
      };
    }

    const ltfLifted = liftCandles(ltfRes.candles);
    const ltfPivots = detectPivots(ltfLifted);
    const ict = analyzeIct(ltfLifted, ltfPivots, { timeframe: data.interval });
    // Diagonal detected on the LTF (execution timeframe) where the wedge
    // and its breakout live.
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
    });
    const decision = decideOperation(analysis, ict, signals, ltfLifted.length, diagonal);

    return {
      symbol: data.symbol,
      timeframe: data.interval,
      htf: htfInterval,
      signals,
      elliott: toElliottResult(analysis, elliottBias),
      decision,
      diagonal,
      provider: ltfRes.provider,
    };
  });