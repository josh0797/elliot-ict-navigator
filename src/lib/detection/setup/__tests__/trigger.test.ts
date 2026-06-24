import { describe, expect, it } from "vitest";
import { deriveTrigger } from "../trigger";
import type { CandleV2 } from "../../schemas/analysis";

function c(index: number, open: number, high: number, low: number, close: number): CandleV2 {
  return { index, time: 1_700_000_000 + index * 60, open, high, low, close };
}

const zone = { top: 105, bottom: 100 };

describe("deriveTrigger — pending orders", () => {
  it("BUY_LIMIT: NOT satisfied when no candle has touched the zone after arming", () => {
    const last = c(50, 108, 109, 107, 108);
    const t = deriveTrigger({
      direction: "long", orderType: "BUY_LIMIT",
      entry: 102, entryZone: zone, currentPrice: 108,
      lastConfirmedCandle: last, armedAtIndex: 50, candlesSinceArmed: [last],
    });
    expect(t.satisfied).toBe(false);
    expect(t.triggerPolicy).toBe("LIMIT_ZONE_INTERSECTION");
  });

  it("BUY_LIMIT: satisfied when a post-armed candle's low ≤ entry", () => {
    const post = c(51, 103, 104, 101.5, 103.5); // low pierces entry=102
    const t = deriveTrigger({
      direction: "long", orderType: "BUY_LIMIT",
      entry: 102, entryZone: zone, currentPrice: 103.5,
      lastConfirmedCandle: post, armedAtIndex: 51, candlesSinceArmed: [post],
    });
    expect(t.satisfied).toBe(true);
    expect(t.triggeredCandleIndex).toBe(51);
    expect(t.triggeredPrice).toBe(102);
  });

  it("SELL_LIMIT: satisfied when high ≥ entry on a post-armed candle", () => {
    const post = c(60, 99, 102.5, 98.5, 100); // high reaches entry=102
    const t = deriveTrigger({
      direction: "short", orderType: "SELL_LIMIT",
      entry: 102, entryZone: zone, currentPrice: 100,
      lastConfirmedCandle: post, armedAtIndex: 60, candlesSinceArmed: [post],
    });
    expect(t.satisfied).toBe(true);
  });

  it("BUY_LIMIT: ignores candles BEFORE armedAtIndex", () => {
    const earlier = c(10, 102, 103, 101, 102); // would fill, but is pre-arm
    const t = deriveTrigger({
      direction: "long", orderType: "BUY_LIMIT",
      entry: 102, entryZone: zone, currentPrice: 108,
      lastConfirmedCandle: earlier, armedAtIndex: 50, candlesSinceArmed: [earlier],
    });
    expect(t.satisfied).toBe(false);
  });
});

describe("deriveTrigger — stop orders use confirmed CLOSE, not intrabar", () => {
  it("BUY_STOP: intrabar high above entry but close back inside → NOT satisfied", () => {
    const last = c(20, 108, 112, 107, 109); // close 109 < entry 110
    const t = deriveTrigger({
      direction: "long", orderType: "BUY_STOP",
      entry: 110, entryZone: { top: 110.5, bottom: 109.5 },
      currentPrice: 112, // ignored
      lastConfirmedCandle: last,
    });
    expect(t.satisfied).toBe(false);
  });

  it("BUY_STOP: confirmed close above entry → satisfied", () => {
    const last = c(21, 109, 112, 108, 111);
    const t = deriveTrigger({
      direction: "long", orderType: "BUY_STOP",
      entry: 110, entryZone: { top: 110.5, bottom: 109.5 },
      currentPrice: 111, lastConfirmedCandle: last,
    });
    expect(t.satisfied).toBe(true);
    expect(t.triggeredPrice).toBe(111);
    expect(t.triggerPolicy).toBe("STOP_CLOSE_BEYOND");
  });

  it("SELL_STOP: confirmed close below entry → satisfied", () => {
    const last = c(30, 100, 101, 95, 96);
    const t = deriveTrigger({
      direction: "short", orderType: "SELL_STOP",
      entry: 98, entryZone: { top: 98.5, bottom: 97.5 },
      currentPrice: 96, lastConfirmedCandle: last,
    });
    expect(t.satisfied).toBe(true);
  });
});

describe("deriveTrigger — MARKET outside zone", () => {
  it("MARKET_BUY: current price ABOVE the entry zone → NOT satisfied", () => {
    const last = c(40, 110, 111, 109, 110);
    const t = deriveTrigger({
      direction: "long", orderType: "MARKET_BUY",
      entry: 102, entryZone: { top: 103, bottom: 101 },
      currentPrice: 110, lastConfirmedCandle: last,
    });
    expect(t.satisfied).toBe(false);
    expect(t.notSatisfiedReason).toBe("PRICE_OUTSIDE_ZONE");
  });
  it("MARKET_BUY: current price INSIDE zone but confirmed close outside → NOT satisfied", () => {
    const last = c(41, 100, 100.5, 99, 99.5); // close 99.5 outside zone
    const t = deriveTrigger({
      direction: "long", orderType: "MARKET_BUY",
      entry: 102, entryZone: { top: 103, bottom: 101 },
      currentPrice: 102, lastConfirmedCandle: last,
    });
    expect(t.satisfied).toBe(false);
  });
});
