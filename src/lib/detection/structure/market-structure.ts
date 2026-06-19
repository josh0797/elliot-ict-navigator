import type { PivotV2 } from "../schemas/analysis";

export type StructureBias = "BULLISH" | "BEARISH" | "NEUTRAL";

/**
 * Classify each pivot as HH/HL/LH/LL relative to the previous same-kind pivot.
 */
export function classifyPivots(pivots: ReadonlyArray<PivotV2>): Array<{ pivot: PivotV2; tag: "HH" | "HL" | "LH" | "LL" | "NA" }> {
  return pivots.map((p, i) => {
    const prev = pivots.slice(0, i).reverse().find((q) => q.type === p.type);
    if (!prev) return { pivot: p, tag: "NA" as const };
    if (p.type === "HIGH") return { pivot: p, tag: p.price > prev.price ? "HH" : "LH" };
    return { pivot: p, tag: p.price < prev.price ? "LL" : "HL" };
  });
}

export function currentBias(pivots: ReadonlyArray<PivotV2>): StructureBias {
  const tagged = classifyPivots(pivots).filter((t) => t.tag !== "NA").slice(-4);
  if (tagged.length < 2) return "NEUTRAL";
  const last = tagged[tagged.length - 1].tag;
  const prev = tagged[tagged.length - 2].tag;
  if ((last === "HH" || last === "HL") && (prev === "HH" || prev === "HL")) return "BULLISH";
  if ((last === "LL" || last === "LH") && (prev === "LL" || prev === "LH")) return "BEARISH";
  return "NEUTRAL";
}