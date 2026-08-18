/**
 * Atomic analysis snapshot.
 *
 * Everything the UI renders for one timeframe lives in a SINGLE immutable
 * object: candles, macro count, local count, ICT and decision. The snapshot is
 * published only when every stage of the same request finished, so the chart
 * can never show 4h candles with 1h counts (or vice versa).
 */

import type { Candle } from "@/lib/twelvedata.functions";
import type { ElliottResultDTO } from "@/lib/detection/elliott/types";
import type { IctContext } from "@/lib/detection/ict/types";
import type { OperationalReport } from "@/lib/detection/decision/types";
import type { TradeSignal } from "@/lib/detection/setup/types";
import type { Freshness } from "@/lib/marketData/freshness";
import { contextTimeframeFor } from "@/lib/detection/mtf";

export interface AnalysisSnapshot {
  symbol: string;
  executionTimeframe: string;
  contextTimeframe: string;
  bars: number;
  provider: string;
  /** UTC epoch seconds shared by every stage of this snapshot. */
  asOf: number;
  lastClosedCandleTime: number;
  freshness: Freshness;
  candles: Candle[];
  macroElliottCount: ElliottResultDTO | null;
  localElliottCount: ElliottResultDTO | null;
  ictAnalysis: IctContext | null;
  decision: OperationalReport | null;
  signals: TradeSignal[];
  buildId: string;
  /** Stable identity of the macro scenario (same for 1h and 4h). */
  macroScenarioId: string | null;
  /** True while only candles are available (counts still computing). */
  partial: boolean;
  /** Live quote, kept strictly separate from the historical series. */
  livePrice: number | null;
}

export function snapshotKey(s: {
  symbol: string;
  executionTimeframe: string;
  contextTimeframe: string;
  bars: number;
  asOf: number;
  buildId: string;
}): string {
  return [s.symbol, s.executionTimeframe, s.contextTimeframe, s.bars, s.asOf, s.buildId].join("|");
}

export function composeSnapshot(input: {
  symbol: string;
  executionTimeframe: string;
  bars: number;
  provider: string;
  asOf: number;
  freshness: Freshness;
  candles: Candle[];
  buildId: string;
  macroElliottCount?: ElliottResultDTO | null;
  localElliottCount?: ElliottResultDTO | null;
  ictAnalysis?: IctContext | null;
  decision?: OperationalReport | null;
  signals?: TradeSignal[];
  macroScenarioId?: string | null;
  livePrice?: number | null;
  partial?: boolean;
}): AnalysisSnapshot {
  const candles = input.candles;
  return {
    symbol: input.symbol,
    executionTimeframe: input.executionTimeframe,
    contextTimeframe: contextTimeframeFor(input.executionTimeframe),
    bars: input.bars,
    provider: input.provider,
    asOf: input.asOf,
    lastClosedCandleTime: candles.length ? candles[candles.length - 1].time : 0,
    freshness: input.freshness,
    candles,
    macroElliottCount: input.macroElliottCount ?? null,
    localElliottCount: input.localElliottCount ?? null,
    ictAnalysis: input.ictAnalysis ?? null,
    decision: input.decision ?? null,
    signals: input.signals ?? [],
    buildId: input.buildId,
    macroScenarioId: input.macroScenarioId ?? null,
    partial: input.partial ?? false,
    livePrice: input.livePrice ?? null,
  };
}

/**
 * Request epoch guard. Every timeframe change starts a new epoch, aborts the
 * previous one where the transport allows it, and makes stale responses
 * unpublishable — a late 4h answer can never overwrite the current 1h state.
 */
export class SnapshotController {
  private epoch = 0;
  private controller: AbortController | null = null;

  begin(): { requestId: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.epoch += 1;
    return { requestId: this.epoch, signal: this.controller.signal };
  }

  get current(): number {
    return this.epoch;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.epoch;
  }

  /** Publish only when `requestId` is still the active epoch. */
  publish<T>(requestId: number, value: T, apply: (value: T) => void): boolean {
    if (!this.isCurrent(requestId)) return false;
    apply(value);
    return true;
  }

  invalidate(): void {
    this.controller?.abort();
    this.controller = null;
    this.epoch += 1;
  }
}