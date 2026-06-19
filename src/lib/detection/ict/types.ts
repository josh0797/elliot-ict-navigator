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

export interface LiquidityLevel {
  type: "BSL" | "SSL";
  price: number;
  time: number;
  touches: number;
  swept: boolean;
}

export interface LiquiditySweep {
  type: "buy_side" | "sell_side";
  price: number;
  time: number;
  index: number;
}

export interface StructureEvent {
  id: string;
  type: "BOS" | "CHoCH";
  direction: "long" | "short";
  price: number;
  time: number;
  index: number;
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
