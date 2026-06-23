/**
 * Setup trigger — single, explicit condition that must be satisfied before
 * the setup graduates from WAIT → BUY/SELL.
 */
import type { OrderType, SignalDirection } from "./types";

export type TriggerType =
  | "PRICE_TOUCH"
  | "CANDLE_CLOSE_ABOVE"
  | "CANDLE_CLOSE_BELOW"
  | "LIQUIDITY_SWEEP"
  | "CHOCH_CONFIRMATION"
  | "BOS_CONFIRMATION"
  | "RETEST_POI";

export interface SetupTrigger {
  type: TriggerType;
  price?: number;
  zone?: { top: number; bottom: number };
  description: string;
  satisfied: boolean;
}

/**
 * Derive a single user-actionable trigger from the chosen entry policy
 * + current price.
 */
export function deriveTrigger(args: {
  direction: SignalDirection;
  orderType: OrderType;
  entry: number;
  entryZone: { top: number; bottom: number };
  currentPrice: number;
}): SetupTrigger {
  const { direction, orderType, entry, entryZone, currentPrice } = args;

  // Market entry → already triggered.
  if (orderType === "MARKET_BUY" || orderType === "MARKET_SELL") {
    return {
      type: "PRICE_TOUCH",
      price: entry,
      zone: entryZone,
      description: `Precio ${currentPrice.toFixed(5)} dentro de la zona ${entryZone.bottom.toFixed(5)}–${entryZone.top.toFixed(5)}. Entrada activa.`,
      satisfied: true,
    };
  }

  // Pending limit orders → wait for retesteo.
  if (orderType === "BUY_LIMIT" || orderType === "SELL_LIMIT") {
    const desc = direction === "long"
      ? `Esperar retesteo del POI ${entryZone.bottom.toFixed(5)}–${entryZone.top.toFixed(5)}.`
      : `Esperar retesteo del POI ${entryZone.bottom.toFixed(5)}–${entryZone.top.toFixed(5)}.`;
    return {
      type: "RETEST_POI",
      zone: entryZone,
      description: desc,
      satisfied: false,
    };
  }

  // Stop orders → break-of-level confirmation
  if (orderType === "BUY_STOP") {
    return {
      type: "CANDLE_CLOSE_ABOVE",
      price: entry,
      description: `Esperar cierre alcista por encima de ${entry.toFixed(5)}.`,
      satisfied: currentPrice > entry,
    };
  }
  if (orderType === "SELL_STOP") {
    return {
      type: "CANDLE_CLOSE_BELOW",
      price: entry,
      description: `Esperar cierre bajista por debajo de ${entry.toFixed(5)}.`,
      satisfied: currentPrice < entry,
    };
  }

  return {
    type: "PRICE_TOUCH",
    price: entry,
    description: "Sin condición activa.",
    satisfied: false,
  };
}