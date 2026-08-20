import { describe, expect, it } from "vitest";
import { candidateMinutes, preRaidWindowStatus } from "../pre-raid.server";
import { inPreRaidWindow } from "../pre-raid";

const MIN = 60;
// Thursday 2026-08-20, 07:20 London (BST) = 06:20 UTC.
const NOW = Math.floor(Date.UTC(2026, 7, 20, 6, 20, 30) / 1000);
const LAST_CLOSED = Math.floor(Date.UTC(2026, 7, 20, 6, 19, 0) / 1000);

describe("pre-raid capture backfill", () => {
  it("enumerates every closed candidate minute in the window, not just every 5th", () => {
    const mins = candidateMinutes({
      nowSeconds: NOW,
      lastStoredAt: null,
      lastClosedM1At: LAST_CLOSED,
    });
    expect(mins.length).toBeGreaterThan(30);
    for (let i = 1; i < mins.length; i++) expect(mins[i] - mins[i - 1]).toBe(MIN);
    expect(mins.every(inPreRaidWindow)).toBe(true);
    // Newest candidate = the minute right after the last closed bar.
    expect(mins[mins.length - 1]).toBe(LAST_CLOSED + MIN);
  });

  it("resumes strictly after the newest stored observation (idempotent catch-up)", () => {
    const stored = Math.floor(Date.UTC(2026, 7, 20, 6, 15, 0) / 1000);
    const mins = candidateMinutes({
      nowSeconds: NOW,
      lastStoredAt: stored,
      lastClosedM1At: LAST_CLOSED,
    });
    expect(mins).toEqual([
      stored + MIN,
      stored + 2 * MIN,
      stored + 3 * MIN,
      stored + 4 * MIN,
      stored + 5 * MIN,
    ]);
    expect(
      candidateMinutes({
        nowSeconds: NOW,
        lastStoredAt: LAST_CLOSED + MIN,
        lastClosedM1At: LAST_CLOSED,
      }),
    ).toEqual([]);
  });

  it("never leaves the validated window even with a stale cursor", () => {
    const mins = candidateMinutes({
      nowSeconds: NOW,
      lastStoredAt: Math.floor(Date.UTC(2026, 6, 1, 0, 0, 0) / 1000),
      lastClosedM1At: LAST_CLOSED,
    });
    expect(mins.every(inPreRaidWindow)).toBe(true);
    expect(mins.length).toBeLessThanOrEqual(130);
  });

  it("reports the validated window in status", () => {
    expect(preRaidWindowStatus(NOW)).toMatchObject({
      active: true,
      window: expect.stringContaining("06:00"),
    });
  });
});
