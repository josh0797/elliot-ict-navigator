import { describe, expect, it } from "vitest";
import { detectStructure } from "../structure";
import type { PivotV2 } from "../../schemas/analysis";

function pv(i: number, price: number, type: "HIGH" | "LOW"): PivotV2 {
  return { id: `${i}-${type}`, index: i, time: i, price, type, strength: "MAJOR", atrDistance: 2, confirmed: true };
}

it("Structure: BOS on continuation HH", () => {
  const pivots = [pv(0, 100, "LOW"), pv(1, 110, "HIGH"), pv(2, 105, "LOW"), pv(3, 120, "HIGH")];
  const events = detectStructure(pivots);
  expect(events.some((e) => e.type === "BOS" && e.direction === "long")).toBeTruthy();
});

it("Structure: CHoCH on trend flip", () => {
  const pivots = [pv(0, 120, "HIGH"), pv(1, 100, "LOW"), pv(2, 110, "HIGH"), pv(3, 90, "LOW"), pv(4, 130, "HIGH")];
  const events = detectStructure(pivots);
  expect(events.some((e) => e.type === "CHoCH")).toBeTruthy();
});