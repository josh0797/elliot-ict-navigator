import { describe, expect, it } from "vitest";
import {
  buildFeatureWindow,
  buildOutcomeWindow,
  buildSmcDataset,
  buildSmcDatasetRow,
  resampleClosed,
  type SmcEntry,
} from "../dataset";
import { SMC_FEATURE_NAMES } from "../features";
import { ENTRY_TIME, forwardSeries, m1Series } from "./dataset-fixtures";

const MIN = 60;
const entry: SmcEntry = {
  id: "p1",
  symbol: "XAU/USD",
  entryTime: ENTRY_TIME + 37, // 07:06:37 — seconds unknown-ish
  direction: "long",
  manualValidationLabels: { clear_displacement: true, disp_strength: 9.9, regime: "Liquidity" },
};

const history = m1Series();
const last = history[history.length - 1];

function rows(perMin: number) {
  const bars = [...history, ...forwardSeries(ENTRY_TIME, last.close, perMin)];
  return buildSmcDatasetRow(entry, bars, { provider: "fixture" });
}

describe("strict cutoff", () => {
  it("uses only M1 bars closed strictly before the entry minute", () => {
    const entryMinuteBar = { ...last, time: ENTRY_TIME, close: 9999, high: 9999, low: 9999 };
    const { bars, cutoff } = buildFeatureWindow([...history, entryMinuteBar], entry.entryTime);
    expect(cutoff).toBe(ENTRY_TIME);
    expect(bars[bars.length - 1].time).toBe(ENTRY_TIME - MIN);
    expect(bars.some((b) => b.time >= ENTRY_TIME)).toBe(false);
  });

  it("excludes partial resampled buckets", () => {
    const { bars, cutoff } = buildFeatureWindow(history, entry.entryTime);
    const m5 = resampleClosed(bars, 300, cutoff);
    for (const b of m5) expect(b.time + 300).toBeLessThanOrEqual(cutoff);
    const m30 = resampleClosed(bars, 1800, cutoff);
    for (const b of m30) expect(b.time + 1800).toBeLessThanOrEqual(cutoff);
  });

  it("records provenance and satisfies strict cutoff", () => {
    const row = rows(0.5);
    expect(row.valid).toBe(true);
    expect(row.provenance.strict_cutoff_satisfied).toBe(true);
    expect(row.provenance.feature_cutoff_time).toBe(ENTRY_TIME);
    expect(row.provenance.last_m1_close_time_used).toBe(ENTRY_TIME);
    expect(row.provenance.m1_bars).toBeGreaterThanOrEqual(240);
    expect(row.provenance.operative_mask).toBe("SMC_OPERATIVE_V1");
    expect(row.features!.vector.length).toBe(SMC_FEATURE_NAMES.length);
    expect(row.features!.operativeVector.length).toBe(22);
  });

  it("rejects rows without enough history instead of filling", () => {
    const short = m1Series({ count: 100 });
    const row = buildSmcDatasetRow(entry, short, {});
    expect(row.valid).toBe(false);
    expect(row.invalid_reason).toContain("insufficient_m1_history");
  });
});

describe("previous trading day history", () => {
  it("resolves the previous UTC day and records provenance", () => {
    const row = rows(0.5);
    expect(row.provenance.previous_day_history_ok).toBe(true);
    expect(row.provenance.previous_trading_day_distance_days).toBe(1);
    expect(row.provenance.previous_trading_day_bars).toBeGreaterThanOrEqual(60);
  });

  it("is invalid (not trainable) when previous-day history is missing", () => {
    // 300 minutes of history only -> same UTC day, no previous day.
    const short = m1Series({ count: 300 });
    const row = buildSmcDatasetRow(entry, [...short, ...forwardSeries(ENTRY_TIME, 2600, 1)], {});
    expect(row.valid).toBe(false);
    expect(row.invalid_reason).toBe("missing_previous_day_history");
    expect(row.features).toBeNull();
    expect(row.outcomes).toBeNull();
    expect(row.provenance.previous_day_history_ok).toBe(false);
  });

  it("skips the weekend for a Monday entry (previous trading day = Friday)", () => {
    // Monday 2025-01-20 07:06 UTC; history covers Fri 17th onward.
    const mondayEntry = Math.floor(Date.parse("2025-01-20T07:06:00Z") / 1000);
    const bars = m1Series({ endOpen: mondayEntry - MIN, count: 3 * 1440 }).filter((b) => {
      const dow = new Date(b.time * 1000).getUTCDay();
      return dow !== 0 && dow !== 6; // market closed at the weekend
    });
    const row = buildSmcDatasetRow(
      { ...entry, entryTime: mondayEntry },
      [...bars, ...forwardSeries(mondayEntry, bars[bars.length - 1].close, 1)],
      {},
    );
    expect(row.valid).toBe(true);
    expect(row.provenance.previous_trading_day_distance_days).toBe(3);
    const fri = new Date(row.provenance.previous_trading_day_start! * 1000).getUTCDay();
    expect(fri).toBe(5);
  });

  it("stays invalid when the whole lookback window has no trading day bars", () => {
    const mondayEntry = Math.floor(Date.parse("2025-01-20T07:06:00Z") / 1000);
    const bars = m1Series({ endOpen: mondayEntry - MIN, count: 400 });
    const row = buildSmcDatasetRow({ ...entry, entryTime: mondayEntry }, bars, {
      previousDayMaxLookbackDays: 1,
    });
    expect(row.valid).toBe(false);
    expect(row.invalid_reason).toBe("missing_previous_day_history");
  });
});

describe("future mutation invariance", () => {
  it("keeps features/audit identical while outcomes differ", () => {
    const up = rows(1.2);
    const down = rows(-1.2);
    expect(JSON.stringify(up.features)).toBe(JSON.stringify(down.features));
    expect(up.outcomes!.mfe_usd).not.toBe(down.outcomes!.mfe_usd);
    expect(up.outcomes!.forward_net_30m_usd).not.toBe(down.outcomes!.forward_net_30m_usd);
  });

  it("post-entry structure cannot leak into the snapshot", () => {
    const spike = forwardSeries(ENTRY_TIME, last.close, 5, 40, 8);
    const withSpike = buildSmcDatasetRow(entry, [...history, ...spike], {});
    const plain = rows(0);
    expect(withSpike.features!.vector).toEqual(plain.features!.vector);
    expect(withSpike.features!.audit).toEqual(plain.features!.audit);
  });

  it("keeps manual labels in the audit namespace only", () => {
    const row = rows(1);
    expect(row.manual_validation_labels?.clear_displacement).toBe(true);
    expect(Object.keys(row.features!.named)).not.toContain("clear_displacement");
    expect(row.features!.operativeNames).not.toContain("disp_strength");
  });
});

describe("outcomes", () => {
  const atrRow = rows(0);
  const atr = atrRow.features!.atrM5;

  it("computes MFE/MAE and forward nets for a long", () => {
    const row = rows(1);
    const o = row.outcomes!;
    expect(o.entry_price_source).toBe("entry_minute_open");
    expect(o.entry_price).toBeCloseTo(last.close, 6);
    expect(o.mfe_usd).toBeGreaterThan(o.mae_usd);
    expect(o.forward_net_5m_usd).toBeCloseTo(5, 6);
    expect(o.forward_net_15m_usd).toBeCloseTo(15, 6);
    expect(o.forward_net_30m_usd).toBeCloseTo(30, 6);
    expect(o.forward_mfe_5m_usd).toBeCloseTo(5.1, 6);
    expect(o.fav_before_adv).toBe(true);
    expect(o.fav_before_adv_state).toBe("FAVORABLE_FIRST");
    expect(o.positive_displacement_5m).toBe(atr <= 5);
    expect(o.meta.atr_used).toBeCloseTo(atr, 10);
  });

  it("computes mirrored values for a short", () => {
    const bars = [...history, ...forwardSeries(ENTRY_TIME, last.close, -1)];
    const row = buildSmcDatasetRow({ ...entry, direction: "short" }, bars, {});
    const o = row.outcomes!;
    expect(o.forward_net_15m_usd).toBeCloseTo(15, 6);
    expect(o.fav_before_adv_state).toBe("FAVORABLE_FIRST");
  });

  it("prefers an explicit entry price", () => {
    const bars = [...history, ...forwardSeries(ENTRY_TIME, last.close, 1)];
    const row = buildSmcDatasetRow({ ...entry, entryPrice: last.close - 2 }, bars, {});
    expect(row.outcomes!.entry_price_source).toBe("provided");
    expect(row.outcomes!.entry_price).toBeCloseTo(last.close - 2, 6);
  });

  it("flags same-bar barrier ambiguity", () => {
    const wide = forwardSeries(ENTRY_TIME, last.close, 0, 40, 50);
    const row = buildSmcDatasetRow(entry, [...history, ...wide], {});
    expect(row.outcomes!.fav_before_adv_state).toBe("AMBIGUOUS_SAME_BAR");
    expect(row.outcomes!.fav_before_adv).toBe(null);
  });

  it("returns NEITHER when no barrier is touched", () => {
    const flat = forwardSeries(ENTRY_TIME, last.close, 0, 40, 0.01);
    const row = buildSmcDatasetRow(entry, [...history, ...flat], {});
    expect(row.outcomes!.fav_before_adv_state).toBe("NEITHER");
    expect(row.outcomes!.fav_before_adv).toBe(null);
    expect(row.outcomes!.outcome_coverage_minutes).toBe(30);
  });
});

describe("batch builder", () => {
  it("loads per entry and reports skips", async () => {
    const bars = [...history, ...forwardSeries(ENTRY_TIME, last.close, 1)];
    const res = await buildSmcDataset(
      [entry, { ...entry, id: "p2", entryTime: ENTRY_TIME + 86400 * 30 }],
      ({ symbol, fromSec, toSec }) => {
        expect(symbol).toBe("XAU/USD");
        return bars.filter((b) => b.time >= fromSec && b.time <= toSec);
      },
    );
    expect(res.rows.length).toBe(1);
    expect(res.skipped[0].reason).toBe("no_coverage");
  });
});

describe("outcome window", () => {
  it("starts at the entry minute", () => {
    const bars = [...history, ...forwardSeries(ENTRY_TIME, last.close, 1)];
    const fwd = buildOutcomeWindow(bars, entry.entryTime, 30);
    expect(fwd[0].time).toBe(ENTRY_TIME);
    expect(fwd.length).toBe(30);
  });
});
