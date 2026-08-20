/**
 * SMC / M30 model family — type contracts (v1).
 *
 * Fully isolated from the Elliott feature vector (`src/lib/ml/dataset.ts`).
 * Nothing in `src/lib/ml/smc/**` may import Elliott modules.
 */
import type { Candle } from "@/lib/marketData/types";
import type {
  FVG,
  LiquidityLevel,
  LiquiditySweep,
  OrderBlock,
  PDArray,
  StructureEvent,
} from "@/lib/detection/ict/types";

/** Model families persisted in `model_versions.family`. */
export type SmcModelFamily = "ELLIOTT_BASELINE" | "SMC_M30" | "ENSEMBLE";

export const SMC_FEATURE_SCHEMA_VERSION = 1;

/** Session buckets tuned for the empirical XAU/USD study (London local time). */
export type SmcSession = "ASIA" | "LONDON_PRE" | "LONDON" | "NY_AM" | "NY_PM" | "OTHER";

export type SmcRegime = "LIQUIDITY_REVERSAL" | "MOMENTUM_CONTINUATION" | "UNKNOWN";

export type CandidateDirection = "long" | "short";

/** DST-aware London clock derived strictly from a UTC timestamp. */
export interface LondonClock {
  /** Unix seconds (input, echoed for traceability). */
  unixSec: number;
  /** London local calendar date, `YYYY-MM-DD`. */
  localDate: string;
  hour: number;
  minute: number;
  /** 0..1439 */
  minuteOfDay: number;
  /** 0 = Sunday … 6 = Saturday, in London local time. */
  dayOfWeek: number;
  /** Offset from UTC in minutes (60 during BST, 0 during GMT). */
  utcOffsetMinutes: number;
  isDst: boolean;
  /** 0..29 — minutes elapsed since the last :00 / :30 boundary. */
  minutesFromM30Boundary: number;
  inFirst15mAfterM30: boolean;
  exactM30Boundary: boolean;
  session: SmcSession;
}

/**
 * Everything the feature builder is allowed to read. All series MUST already be
 * truncated to the feature timestamp by the caller — the builder never looks
 * past the last element it is given.
 */
export interface SmcFeatureContext {
  /** Candles at or before the feature timestamp; last element is the anchor bar. */
  candles: Candle[];
  /** Feature timestamp (unix seconds) — normally `candles.at(-1).time`. */
  atTime: number;
  direction: CandidateDirection;
  /** ATR series aligned to `candles` (same length) or a single latest value. */
  atr: number[] | number;
  liquidity?: LiquidityLevel[];
  sweeps?: LiquiditySweep[];
  structure?: StructureEvent[];
  fvgs?: FVG[];
  orderBlocks?: OrderBlock[];
  pdArray?: PDArray | null;
  /** Previous-day high/low, when resolvable at `atTime`. */
  previousDay?: { high: number; low: number } | null;
  /** Asia-session high/low for the current London day, when resolvable. */
  asiaRange?: { high: number; low: number; sweptHigh: boolean; sweptLow: boolean } | null;
}

export interface SmcFeatureResult {
  schemaVersion: number;
  featureNames: readonly string[];
  /** Same order as `featureNames`; always finite numbers. */
  vector: number[];
  /** Named view of the same values, for inspection/debugging. */
  named: Record<string, number>;
  clock: LondonClock;
  atTime: number;
  direction: CandidateDirection;
}

export interface SmcRegimeResult {
  regime: SmcRegime;
  /** 0..1 support for the winning regime. */
  confidence: number;
  reasons: string[];
  flags: {
    sweepAgainstDirection: boolean;
    sweepCloseBack: boolean;
    oppositeDisplacement: boolean;
    directionalExpansion: boolean;
    structureAligned: boolean;
    conflictingReversal: boolean;
  };
}
