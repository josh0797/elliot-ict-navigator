import type { Bias } from "../elliott/types";

export interface FVG {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  startIndex: number;
  startTime: number;
  endTime: number;
  mitigated: boolean;
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  index: number;
  time: number;
  mitigated: boolean;
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
