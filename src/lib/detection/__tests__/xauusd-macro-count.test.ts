import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { liftCandles } from "../schemas/analysis";
import { detectPivots } from "../structure/pivots";
import { analyzeElliott } from "../elliott/engine";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(resolve(here, "fixtures/xauusd-1d.json"), "utf8"),
) as ReadonlyArray<{ time: number; open: number; high: number; low: number; close: number }>;

describe("XAU/USD 1D macro Elliott count", () => {
  it("primary count reaches wave 5 (or corrective C) — impulse detected", () => {
    const lifted = liftCandles(raw);
    const pivots = detectPivots(lifted);
    const analysis = analyzeElliott(pivots);
    expect(analysis.primary).not.toBeNull();
    const p = analysis.primary!;
    expect(p.state).toBe("COMPLETED");
    // Impulse must span all 6 labels; corrective A/B/C may append.
    const labels = p.labeled.map((l) => l.label).join("-");
    expect(labels.startsWith("0-1-2-3-4-5")).toBe(true);
    expect(["5", "A", "B", "C"]).toContain(p.currentWave);
    expect(p.invalidations).toEqual([]);
  });
});