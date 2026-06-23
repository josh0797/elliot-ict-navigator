import type { Bias } from "../elliott/types";

export interface FVG {
  id: string;
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  startIndex: number;
  startTime: number;
  endTime: number;
  mitigated: boolean;
}

export type OBState = "FRESH" | "TOUCHED" | "MITIGATED" | "INVALIDATED" | "BREAKER";
export type OBRangePolicy = "FULL_CANDLE" | "BODY" | "OPEN_TO_LOW" | "OPEN_TO_HIGH";

export interface OrderBlock {
  id: string;
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  originIndex: number;
  originTime: number;
  state: OBState;
  touchCount: number;
  /** 0..100 — how far into the OB price has reached. */
  mitigationPercent: number;
  displacementConfirmed: boolean;
  bosConfirmed: boolean;
  fvgAssociated: boolean;
  /** undefined when provider gives no volume — never penalises quality. */
  volumeConfirmation: boolean;
  bosRef: string | null;
  fvgRef: string | null;
  /** 0..100 composite score. */
  quality: number;
  rangePolicy: OBRangePolicy;
}

/**
 * Canonical Phase 6 liquidity primitives.
 */
export type LiquiditySide = "BSL" | "SSL";
export type LiquidityKind =
  | "EQH" | "EQL"            // equal highs / equal lows (stop clusters)
  | "SWING_HIGH" | "SWING_LOW"
  | "PDH" | "PDL"            // previous-day high / low
  | "PWH" | "PWL"            // previous-week high / low
  | "SESSION_HIGH" | "SESSION_LOW"
  | "ASIA_HIGH" | "ASIA_LOW";
export type LiquidityState = "ACTIVE" | "SWEPT" | "MITIGATED" | "BROKEN";

export interface LiquidityLevel {
  id: string;
  side: LiquiditySide;
  kind: LiquidityKind;
  price: number;
  time: number;
  /** Indices that contributed to the cluster (>=1). */
  originIndices: number[];
  touches: number;
  state: LiquidityState;
  sweptAtIndex: number | null;
  sweptAtTime: number | null;
  /** 0..100 — number of touches + cluster width + recency. */
  strength: number;
  /**
   * Provisional levels (e.g. current SESSION_HIGH/LOW, ASIA range while still
   * developing) can change on every new bar and MUST NOT be treated like
   * confirmed historical levels by consumers.
   */
  provisional: boolean;
}

export interface LiquiditySweep {
  id: string;
  side: LiquiditySide;
  /** "buy_side" sweeps a BSL (raid on highs); "sell_side" sweeps a SSL. */
  type: "buy_side" | "sell_side";
  price: number;
  time: number;
  index: number;
  /** Liquidity level that was raided. */
  targetLiquidityId: string;
  /** Wick exceeded the level. */
  wickBeyond: boolean;
  /** Candle closed back inside the prior range (stop-hunt confirmation). */
  closeBack: boolean;
  /** A BOS opposite the sweep printed within the displacement window. */
  displacementAfter: boolean;
  /** True once price has retraced into the swept range after the sweep. */
  mitigated: boolean;
  /** 0..100 composite. */
  quality: number;
}

export type StructureState = "PROVISIONAL" | "CONFIRMED" | "FAILED";

export interface StructureEvent {
  id: string;
  type: "BOS" | "CHoCH";
  direction: "long" | "short";
  /** Pivot price that was broken. */
  price: number;
  time: number;
  /** Candle index where the breaking close happened. */
  index: number;
  state: StructureState;
  /** Reference to the protected pivot whose level was broken. */
  brokenPivotId: string;
  /** Reference to the swing leg leading to that pivot, when known. */
  brokenSwingId?: string;
  breakIndex: number;
  breakPrice: number;
  /** Magnitude of the close beyond the broken level, expressed in ATR units. */
  closeBeyondAtr: number;
  /** Whether the break candle qualifies as displacement (body >= 1.5*ATR). */
  displacement: boolean;
  /** Optional reference to a confirming displacement candle id. */
  displacementId?: string;
  /** For CHoCH, optional reference to a preceding liquidity sweep. */
  precedingSweepId?: string;
}

export type KillzoneName = "ASIA" | "LONDON" | "NY_AM" | "NY_PM" | null;

export interface Killzone {
  name: Exclude<KillzoneName, null>;
  startUtc: number;
  endUtc: number;
  activeAt: number;
}

export type PdZone = "PREMIUM" | "EQUILIBRIUM" | "DISCOUNT";

export interface PDArray {
  high: number;
  low: number;
  midpoint: number;
  currentPrice: number;
  zone: PdZone;
  position: number;
}

export interface IctContext {
  bias: Bias;
  fvgs: FVG[];
  orderBlocks: OrderBlock[];
  liquidity: LiquidityLevel[];
  sweeps: LiquiditySweep[];
  structure: StructureEvent[];
  killzone: Killzone | null;
  pdArray: PDArray | null;
  score: number;
}
