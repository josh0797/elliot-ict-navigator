import { describe, expect, it } from "vitest";
import { generateNegativeCandidates, negativesToEntries } from "../negatives";
import type { SmcEntry } from "../dataset";
import { londonClock } from "../clock";
import { buildFeatureWindow } from "../dataset";
import { ENTRY_TIME, forwardSeries, m1Series } from "./dataset-fixtures";

const positives: SmcEntry[] = [
  { id: "p1", symbol: "XAU/USD", entryTime: ENTRY_TIME, direction: "long" },
  { id: "p2", symbol: "XAU/USD", entryTime: ENTRY_TIME + 86400, direction: "short" },
];

describe("negative sampling", () => {
  it("is deterministic for the same seed and non-empty", () => {
    const a = generateNegativeCandidates(positives, { seed: "s1" });
    const b = generateNegativeCandidates(positives, { seed: "s1" });
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((x) => x.entryTime)).toEqual(b.map((x) => x.entryTime));
  });

  it("honours exclusion zones, session and M30 phase matching", () => {
    const negs = generateNegativeCandidates(positives, { seed: "s1" });
    for (const n of negs) {
      for (const p of positives) {
        expect(Math.abs(n.entryTime - p.entryTime)).toBeGreaterThan(15 * 60);
      }
      const pos = positives.find((p) => p.id === n.meta.paired_positive_id)!;
      expect(londonClock(n.entryTime).session).toBe(londonClock(pos.entryTime).session);
      expect(n.meta.same_m30_phase).toBe(true);
      expect(n.direction).toBe(pos.direction);
      expect(n.meta.negative_kind).toBe(n.kind);
    }
  });

  it("produces no duplicate minutes", () => {
    const negs = generateNegativeCandidates(positives, { seed: "s1" });
    expect(new Set(negs.map((n) => n.entryTime)).size).toBe(negs.length);
  });

  it("never inspects outcomes — only pre-entry stats influence selection", () => {
    const stats = (minute: number) => ({ atr: 1 + (minute % 3) * 0.05, range60: 5 });
    const a = generateNegativeCandidates(positives, { seed: "s1", preEntryStats: stats });
    const b = generateNegativeCandidates(positives, { seed: "s1", preEntryStats: stats });
    expect(a.map((x) => `${x.entryTime}:${x.kind}`)).toEqual(
      b.map((x) => `${x.entryTime}:${x.kind}`),
    );
    expect(a.some((x) => x.kind === "HARD_NEGATIVE")).toBe(true);
  });

  it("converts to dataset entries flagged as non-SONIC", () => {
    const entries = negativesToEntries(generateNegativeCandidates(positives, { seed: "s1" }));
    expect(entries.every((e) => e.kind !== "SONIC_ENTRY")).toBe(true);
    expect(entries.every((e) => e.negative?.paired_positive_id)).toBe(true);
  });
});

describe("outcome-window contamination exclusion", () => {
  it("rejects candidates whose 30m forward window overlaps any positive entry", () => {
    const negs = generateNegativeCandidates(positives, { seed: "s1" });
    expect(negs.length).toBeGreaterThan(0);
    for (const n of negs) {
      for (const p of positives) {
        expect(Math.abs(n.entryTime - p.entryTime)).toBeGreaterThanOrEqual(30 * 60);
      }
    }
  });

  it("shrinks the excluded interval when the guard is disabled", () => {
    const guarded = generateNegativeCandidates(positives, { seed: "s1" });
    const open = generateNegativeCandidates(positives, {
      seed: "s1",
      excludeOutcomeOverlap: false,
    });
    const minGap = (list: typeof open) =>
      Math.min(
        ...list.map((n) => Math.min(...positives.map((p) => Math.abs(n.entryTime - p.entryTime)))),
      );
    expect(minGap(open)).toBeLessThan(minGap(guarded));
    expect(minGap(open)).toBeGreaterThan(15 * 60);
  });

  it("honours a custom horizon", () => {
    const negs = generateNegativeCandidates(positives, { seed: "s1", outcomeHorizonMinutes: 45 });
    for (const n of negs)
      for (const p of positives)
        expect(Math.abs(n.entryTime - p.entryTime)).toBeGreaterThanOrEqual(45 * 60);
  });
});

describe("same-week fallback", () => {
  const single: SmcEntry[] = [positives[0]];

  it("falls back to nearest same-week trading days when the same date is starved", () => {
    const negs = generateNegativeCandidates(single, {
      seed: "s1",
      perPositive: 6,
      windowMinutes: 30,
    });
    expect(negs.length).toBe(6);
    const fallback = negs.filter((n) => !n.meta.same_date);
    expect(fallback.length).toBeGreaterThan(0);
    for (const n of fallback) {
      expect(Math.abs(n.meta.day_distance!)).toBeGreaterThan(0);
      expect(Math.abs(n.meta.day_distance!)).toBeLessThanOrEqual(4);
      expect(londonClock(n.entryTime).session).toBe(londonClock(single[0].entryTime).session);
      expect(n.meta.same_m30_phase).toBe(true);
      expect(n.direction).toBe(single[0].direction);
    }
    // same-date controls are preferred first
    const sameDate = negs.filter((n) => n.meta.same_date);
    expect(sameDate.length).toBeGreaterThan(0);
  });

  it("stays same-date only when the same day has enough controls", () => {
    const negs = generateNegativeCandidates(single, { seed: "s1" });
    expect(negs.every((n) => n.meta.same_date)).toBe(true);
    expect(negs.every((n) => n.meta.day_distance === 0)).toBe(true);
  });

  it("can be disabled", () => {
    const negs = generateNegativeCandidates(single, {
      seed: "s1",
      perPositive: 6,
      windowMinutes: 30,
      sameWeekFallback: false,
    });
    expect(negs.every((n) => n.meta.same_date)).toBe(true);
    expect(negs.length).toBeLessThan(6);
  });
});

describe("selection is future-independent (integration boundary)", () => {
  /** preEntryStats built ONLY from bars strictly closed before the candidate minute. */
  function statsFrom(bars: ReturnType<typeof m1Series>) {
    return (minute: number) => {
      const { bars: window } = buildFeatureWindow(bars, minute);
      if (window.length < 60) return null;
      const last60 = window.slice(-60);
      let hi = -Infinity;
      let lo = Infinity;
      let tr = 0;
      for (const c of last60) {
        hi = Math.max(hi, c.high);
        lo = Math.min(lo, c.low);
        tr += c.high - c.low;
      }
      return { atr: tr / last60.length, range60: hi - lo };
    };
  }

  it("keeps identical timestamps and kinds when only bars after the sampled region change", () => {
    // Shared history covers every candidate minute the sampler can reach
    // (last positive + windowMinutes + outcome horizon).
    const lastSampled = positives[1].entryTime + (60 + 30) * 60;
    const shared = m1Series({ endOpen: lastSampled, count: 4000 });
    const tail = shared[shared.length - 1];
    const up = [...shared, ...forwardSeries(lastSampled + 60, tail.close, 4, 240, 9)];
    const down = [...shared, ...forwardSeries(lastSampled + 60, tail.close, -4, 240, 9)];

    const run = (bars: typeof up) =>
      generateNegativeCandidates(positives, {
        seed: "future-inv",
        preEntryStats: statsFrom(bars),
      }).map((n) => `${n.entryTime}:${n.kind}`);

    const a = run(shared);
    expect(a.length).toBeGreaterThan(0);
    expect(a.some((x) => x.endsWith("HARD_NEGATIVE"))).toBe(true);
    expect(run(up)).toEqual(a);
    expect(run(down)).toEqual(a);
  });
});
