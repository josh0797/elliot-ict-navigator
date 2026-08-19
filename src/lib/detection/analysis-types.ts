/** Client-safe response contracts for the analysis server functions. */
import type { ElliottResultDTO } from "./elliott/types";
import type { ElliottDegree } from "./elliott/degrees";
import type { IctContext } from "./ict/types";
import type { MarketProvider } from "@/lib/marketData/types";

export interface AnalyzeResponse {
  /** Count computed on the DISPLAYED timeframe (drawable 1:1 on the chart). */
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
  /** Stable macro scenario identity, shared across execution timeframes. */
  macroScenarioId?: string | null;
  /** Snapshot timestamp actually used. */
  asOf?: number;
}
