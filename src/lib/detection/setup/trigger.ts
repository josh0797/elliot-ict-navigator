/**
 * Setup trigger — single, explicit condition that must be satisfied before
 * the setup graduates from WAIT → BUY/SELL.
 */
import type { CandleV2 } from "../schemas/analysis";
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
  /** Policy applied to evaluate `satisfied`. */
  triggerPolicy?:
    | "MARKET_INSIDE_ZONE"
    | "LIMIT_ZONE_INTERSECTION"
    | "STOP_CLOSE_BEYOND"
    | "MANUAL";
  triggeredAt?: number | null;
  triggeredCandleIndex?: number | null;
  triggeredPrice?: number | null;
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
  /** Last *confirmed* (closed) candle. STOP triggers require a real close. */
  lastConfirmedCandle?: CandleV2 | null;
  /** Candles printed AFTER the setup was armed (used to scan LIMIT fills). */
  armedAtIndex?: number | null;
  candlesSinceArmed?: ReadonlyArray<CandleV2>;
}): SetupTrigger {
  const {
    direction, orderType, entry, entryZone, currentPrice,
    lastConfirmedCandle = null, armedAtIndex = null, candlesSinceArmed = [],
  } = args;

  // Market entry → already triggered.
  if (orderType === "MARKET_BUY" || orderType === "MARKET_SELL") {
    return {
      type: "PRICE_TOUCH",
      price: entry,
      zone: entryZone,
      description: `Precio ${currentPrice.toFixed(5)} dentro de la zona ${entryZone.bottom.toFixed(5)}–${entryZone.top.toFixed(5)}. Entrada activa.`,
      satisfied: true,
      triggerPolicy: "MARKET_INSIDE_ZONE",
      triggeredAt: lastConfirmedCandle?.time ?? null,
      triggeredCandleIndex: lastConfirmedCandle?.index ?? null,
      triggeredPrice: currentPrice,
    };
  }

  // Pending limit orders → fill when a post-armed candle intersects the zone.
  if (orderType === "BUY_LIMIT" || orderType === "SELL_LIMIT") {
    const scan = candlesSinceArmed.length
      ? candlesSinceArmed
      : (lastConfirmedCandle ? [lastConfirmedCandle] : []);
    const lo = entryZone.bottom;
    const hi = entryZone.top;
    let hit: CandleV2 | null = null;
    for (const c of scan) {
      if (armedAtIndex != null && c.index < armedAtIndex) continue;
      const intersects = c.low <= hi && c.high >= lo;
      const fillsEntry = orderType === "BUY_LIMIT" ? c.low <= entry : c.high >= entry;
      if (intersects && fillsEntry) { hit = c; break; }
    }
    const desc = hit
      ? `Orden ${orderType} ejecutada en vela ${hit.index} (zona ${lo.toFixed(5)}–${hi.toFixed(5)}).`
      : `Esperar retesteo del POI ${lo.toFixed(5)}–${hi.toFixed(5)}.`;
    return {
      type: "RETEST_POI",
      zone: entryZone,
      description: desc,
      satisfied: hit !== null,
      triggerPolicy: "LIMIT_ZONE_INTERSECTION",
      triggeredAt: hit ? hit.time : null,
      triggeredCandleIndex: hit ? hit.index : null,
      triggeredPrice: hit ? entry : null,
    };
    void direction;
  }

  // Stop orders → require a CONFIRMED candle CLOSE beyond entry (no intrabar).
  const confClose = lastConfirmedCandle?.close;
  if (orderType === "BUY_STOP") {
    const satisfied = typeof confClose === "number" && confClose > entry;
    return {
      type: "CANDLE_CLOSE_ABOVE",
      price: entry,
      description: `Esperar cierre alcista por encima de ${entry.toFixed(5)}.`,
      satisfied,
      triggerPolicy: "STOP_CLOSE_BEYOND",
      triggeredAt: satisfied ? lastConfirmedCandle!.time : null,
      triggeredCandleIndex: satisfied ? lastConfirmedCandle!.index : null,
      triggeredPrice: satisfied ? confClose! : null,
    };
  }
  if (orderType === "SELL_STOP") {
    const satisfied = typeof confClose === "number" && confClose < entry;
    return {
      type: "CANDLE_CLOSE_BELOW",
      price: entry,
      description: `Esperar cierre bajista por debajo de ${entry.toFixed(5)}.`,
      satisfied,
      triggerPolicy: "STOP_CLOSE_BEYOND",
      triggeredAt: satisfied ? lastConfirmedCandle!.time : null,
      triggeredCandleIndex: satisfied ? lastConfirmedCandle!.index : null,
      triggeredPrice: satisfied ? confClose! : null,
    };
  }

  return {
    type: "PRICE_TOUCH",
    price: entry,
    description: "Sin condición activa.",
    satisfied: false,
    triggerPolicy: "MANUAL",
    triggeredAt: null,
    triggeredCandleIndex: null,
    triggeredPrice: null,
  };
}