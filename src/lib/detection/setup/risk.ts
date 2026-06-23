/**
 * Structural Stop Loss computation. SL is placed beyond the most extreme
 * relevant structural level (POI distal, sweep extreme, protected swing,
 * Elliott invalidation) plus an ATR-scaled buffer.
 */
import type { SignalDirection, SLBasis } from "./types";

export type StopReason =
  | "BEYOND_SWEEP"
  | "BEYOND_ORDER_BLOCK"
  | "BEYOND_PROTECTED_SWING"
  | "ELLIOTT_INVALIDATION";

export interface StopLossResult {
  price: number;
  basis: SLBasis;
  reason: StopReason;
}

export function computeStopLoss(args: {
  direction: SignalDirection;
  poiDistal: number;
  atr: number;
  atrBufferMultiplier: number;
  elliottInvalidation: number | null;
  sweepExtreme: number | null;
  protectedSwing: number | null;
}): StopLossResult {
  const { direction, poiDistal, atr, atrBufferMultiplier } = args;
  const buffer = atr * atrBufferMultiplier;

  const parts: Array<{ key: StopReason; value: number }> = [
    { key: "BEYOND_ORDER_BLOCK", value: poiDistal },
  ];
  if (args.elliottInvalidation != null && Number.isFinite(args.elliottInvalidation)) {
    parts.push({ key: "ELLIOTT_INVALIDATION", value: args.elliottInvalidation });
  }
  if (args.sweepExtreme != null && Number.isFinite(args.sweepExtreme)) {
    parts.push({ key: "BEYOND_SWEEP", value: args.sweepExtreme });
  }
  if (args.protectedSwing != null && Number.isFinite(args.protectedSwing)) {
    parts.push({ key: "BEYOND_PROTECTED_SWING", value: args.protectedSwing });
  }

  // Pick the most conservative side.
  const ranked = parts.slice().sort((a, b) =>
    direction === "long" ? a.value - b.value : b.value - a.value,
  );
  const chosen = ranked[0];
  const sl = direction === "long" ? chosen.value - buffer : chosen.value + buffer;
  return {
    price: sl,
    reason: chosen.key,
    basis: {
      elliottInvalidation: args.elliottInvalidation,
      poiExtreme: poiDistal,
      sweepExtreme: args.sweepExtreme,
      protectedSwing: args.protectedSwing,
      atrBuffer: buffer,
      chosen: direction === "long" ? "min" : "max",
    },
  };
}