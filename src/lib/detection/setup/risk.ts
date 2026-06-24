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

export type StopLossError = "NO_VALID_STRUCTURAL_STOP" | "INVALID_ATR" | "INVALID_INPUT" | "STOP_TOO_FAR";

export type StopLossResult =
  | { valid: true; price: number; basis: SLBasis; reason: StopReason }
  | { valid: false; error: StopLossError };

/** Maximum SL distance from entry in ATR units. */
const MAX_STOP_DISTANCE_ATR = 12;

export function computeStopLoss(args: {
  direction: SignalDirection;
  entry: number;
  poiDistal: number;
  atr: number;
  atrBufferMultiplier: number;
  elliottInvalidation: number | null;
  sweepExtreme: number | null;
  protectedSwing: number | null;
}): StopLossResult {
  const { direction, entry, poiDistal, atr, atrBufferMultiplier } = args;
  if (!Number.isFinite(atr) || atr <= 0) return { valid: false, error: "INVALID_ATR" };
  if (!Number.isFinite(entry) || !Number.isFinite(poiDistal) || !Number.isFinite(atrBufferMultiplier)) {
    return { valid: false, error: "INVALID_INPUT" };
  }
  const buffer = atr * atrBufferMultiplier;
  if (!Number.isFinite(buffer)) return { valid: false, error: "INVALID_INPUT" };

  const raw: Array<{ key: StopReason; value: number }> = [
    { key: "BEYOND_ORDER_BLOCK", value: poiDistal },
  ];
  if (args.elliottInvalidation != null && Number.isFinite(args.elliottInvalidation)) {
    raw.push({ key: "ELLIOTT_INVALIDATION", value: args.elliottInvalidation });
  }
  if (args.sweepExtreme != null && Number.isFinite(args.sweepExtreme)) {
    raw.push({ key: "BEYOND_SWEEP", value: args.sweepExtreme });
  }
  if (args.protectedSwing != null && Number.isFinite(args.protectedSwing)) {
    raw.push({ key: "BEYOND_PROTECTED_SWING", value: args.protectedSwing });
  }

  // Only keep structural levels on the correct side of entry.
  const parts = raw.filter((p) =>
    direction === "long" ? p.value < entry : p.value > entry,
  );
  if (parts.length === 0) return { valid: false, error: "NO_VALID_STRUCTURAL_STOP" };

  // Pick the most conservative side.
  const ranked = parts.slice().sort((a, b) =>
    direction === "long" ? a.value - b.value : b.value - a.value,
  );
  const chosen = ranked[0];
  const sl = direction === "long" ? chosen.value - buffer : chosen.value + buffer;
  if (!Number.isFinite(sl)) return { valid: false, error: "INVALID_INPUT" };
  // Side sanity.
  if (direction === "long" && !(sl < entry)) return { valid: false, error: "NO_VALID_STRUCTURAL_STOP" };
  if (direction === "short" && !(sl > entry)) return { valid: false, error: "NO_VALID_STRUCTURAL_STOP" };
  // Distance sanity.
  if (Math.abs(entry - sl) > MAX_STOP_DISTANCE_ATR * atr) {
    return { valid: false, error: "STOP_TOO_FAR" };
  }
  return {
    valid: true,
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