import type { Candle } from "../twelvedata.functions";

export type Pivot = {
  index: number;
  time: number;
  price: number;
  type: "H" | "L";
};

export type WaveLabel = "1" | "2" | "3" | "4" | "5" | "A" | "B" | "C";

export type ElliottCount = {
  pivots: Pivot[];
  labels: WaveLabel[];
  direction: "long" | "short";
  degree: "minor" | "intermediate";
  /** Index in `pivots` of the most recent labeled pivot. */
  currentWave: WaveLabel | null;
  valid: boolean;
  reason?: string;
};

export type OrderBlock = {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  startTime: number;
  endTime: number;
};

export type FVG = {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  time: number;
};

export type LiquiditySweep = {
  type: "buy_side" | "sell_side";
  price: number;
  time: number;
};

export type StructureEvent = {
  type: "BOS" | "CHoCH";
  direction: "long" | "short";
  price: number;
  time: number;
};

export type ICTContext = {
  orderBlocks: OrderBlock[];
  fvgs: FVG[];
  sweeps: LiquiditySweep[];
  structure: StructureEvent[];
};

export type TradeSetup = {
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  score: number;
  wave: ElliottCount;
  ict: ICTContext;
  rationale: string;
  detectedAt: number;
};

export type { Candle };