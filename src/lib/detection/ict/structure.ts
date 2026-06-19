import type { PivotV2 } from "../schemas/analysis";
import type { StructureEvent } from "./types";

/**
 * BOS = continuation new HH (up) / LL (down).
 * CHoCH = first counter-trend break.
 */
export function detectStructure(pivots: ReadonlyArray<PivotV2>): StructureEvent[] {
  const out: StructureEvent[] = [];
  let trend: "up" | "down" | null = null;
  const lastSameType = (i: number, type: "HIGH" | "LOW") => {
    for (let j = i - 1; j >= 0; j--) if (pivots[j].type === type) return pivots[j];
    return null;
  };
  for (let i = 1; i < pivots.length; i++) {
    const p = pivots[i];
    const prev = lastSameType(i, p.type);
    if (!prev) continue;
    if (p.type === "HIGH" && p.price > prev.price) {
      if (trend === "down") {
        out.push({ type: "CHoCH", direction: "long", price: prev.price, time: p.time, index: p.index });
      } else {
        // up trend continuation OR first directional break.
        out.push({ type: "BOS", direction: "long", price: prev.price, time: p.time, index: p.index });
      }
      trend = "up";
    } else if (p.type === "LOW" && p.price < prev.price) {
      if (trend === "up") {
        out.push({ type: "CHoCH", direction: "short", price: prev.price, time: p.time, index: p.index });
      } else {
        out.push({ type: "BOS", direction: "short", price: prev.price, time: p.time, index: p.index });
      }
      trend = "down";
    }
  }
  return out;
}
