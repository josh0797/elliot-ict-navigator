/**
 * POI selection — ranks active POIs aligned with the operational direction.
 *
 * Priority (high → low):
 *   1. OB + FVG intersection
 *   2. OB confirmed (FRESH/TOUCHED) + active FVG (loose pairing)
 *   3. OB confirmed alone
 *   4. FVG active with displacement parent OB
 * Fibonacci is never a setup on its own.
 */
import type { FVG, IctContext, OrderBlock } from "../ict/types";
import type { SignalDirection } from "./types";

export interface SelectedPOI {
  type: "OB" | "FVG" | "OB_FVG_INTERSECTION";
  direction: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  proximal: number;
  distal: number;
  midpoint: number;
  /** 0..100 composite quality (higher = better). */
  quality: number;
  sourceIds: string[];
}

function overlap(a: { top: number; bottom: number }, b: { top: number; bottom: number }):
  { top: number; bottom: number } | null {
  const top = Math.min(a.top, b.top);
  const bottom = Math.max(a.bottom, b.bottom);
  return top > bottom ? { top, bottom } : null;
}

function obAligned(ob: OrderBlock, dir: SignalDirection): boolean {
  if (ob.state !== "FRESH" && ob.state !== "TOUCHED") return false;
  return dir === "long" ? ob.type === "BULLISH" : ob.type === "BEARISH";
}
function fvgAligned(f: FVG, dir: SignalDirection): boolean {
  if (f.mitigated) return false;
  return dir === "long" ? f.type === "bullish" : f.type === "bearish";
}

function proximalDistal(dir: SignalDirection, top: number, bottom: number) {
  return dir === "long"
    ? { proximal: top, distal: bottom }
    : { proximal: bottom, distal: top };
}

function dirLabel(dir: SignalDirection): "BULLISH" | "BEARISH" {
  return dir === "long" ? "BULLISH" : "BEARISH";
}

/**
 * Returns POI candidates ordered by priority + quality.
 * Caller is responsible for additional gating (price vs distal, RR, etc.).
 */
export function selectPois(
  ict: IctContext,
  direction: SignalDirection,
): SelectedPOI[] {
  const obs = ict.orderBlocks.filter((ob) => obAligned(ob, direction));
  const fvgs = ict.fvgs.filter((f) => fvgAligned(f, direction));
  const out: SelectedPOI[] = [];

  // 1. Intersections
  for (const ob of obs) {
    for (const f of fvgs) {
      const ov = overlap(ob, f);
      if (!ov) continue;
      const { proximal, distal } = proximalDistal(direction, ov.top, ov.bottom);
      out.push({
        type: "OB_FVG_INTERSECTION",
        direction: dirLabel(direction),
        top: ov.top,
        bottom: ov.bottom,
        proximal,
        distal,
        midpoint: (ov.top + ov.bottom) / 2,
        quality: Math.min(100, ob.quality + 10),
        sourceIds: [ob.id, f.id],
      });
    }
  }

  // 2./3. Standalone OBs (skip ones already covered by intersection)
  const usedObIds = new Set(out.flatMap((p) => p.sourceIds));
  for (const ob of obs) {
    if (usedObIds.has(ob.id)) continue;
    const { proximal, distal } = proximalDistal(direction, ob.top, ob.bottom);
    out.push({
      type: "OB",
      direction: dirLabel(direction),
      top: ob.top,
      bottom: ob.bottom,
      proximal,
      distal,
      midpoint: (ob.top + ob.bottom) / 2,
      quality: ob.quality,
      sourceIds: [ob.id],
    });
  }

  // 4. Standalone FVGs (only when displacement evidence exists → has parent OB)
  const usedFvgIds = new Set(out.flatMap((p) => p.sourceIds));
  for (const f of fvgs) {
    if (usedFvgIds.has(f.id)) continue;
    const { proximal, distal } = proximalDistal(direction, f.top, f.bottom);
    out.push({
      type: "FVG",
      direction: dirLabel(direction),
      top: f.top,
      bottom: f.bottom,
      proximal,
      distal,
      midpoint: (f.top + f.bottom) / 2,
      quality: 60,
      sourceIds: [f.id],
    });
  }

  out.sort((a, b) => {
    const priority: Record<SelectedPOI["type"], number> = {
      OB_FVG_INTERSECTION: 3,
      OB: 2,
      FVG: 1,
    };
    if (priority[a.type] !== priority[b.type]) return priority[b.type] - priority[a.type];
    return b.quality - a.quality;
  });
  return out;
}