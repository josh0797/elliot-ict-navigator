import { describe, expect, it } from "vitest";
import { generateNegativeCandidates, negativesToEntries } from "../negatives";
import type { SmcEntry } from "../dataset";
import { londonClock } from "../clock";
import { ENTRY_TIME } from "./dataset-fixtures";

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
