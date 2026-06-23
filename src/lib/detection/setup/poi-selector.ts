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
  /** Distance from current price to the proximal edge, in ATR multiples (null when unknown). */
  distanceAtr?: number | null;
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

/**
 * Displacement evidence for an FVG: an aligned, non-invalidated Order Block
 * with `displacementConfirmed === true` references this FVG via `fvgRef`.
 * Without such evidence the FVG is treated as noise (no standalone setup).
 */
function fvgHasDisplacement(
  f: FVG,
  obs: ReadonlyArray<OrderBlock>,
  dir: SignalDirection,
): boolean {
  return obs.some(
    (ob) =>
      ob.fvgRef === f.id &&
      ob.displacementConfirmed &&
      obAligned(ob, dir),
  );
}

function proximalDistal(dir: SignalDirection, top: number, bottom: number) {
  return dir === "long"
    ? { proximal: top, distal: bottom }
    : { proximal: bottom, distal: top };
}

function dirLabel(dir: SignalDirection): "BULLISH" | "BEARISH" {
  return dir === "long" ? "BULLISH" : "BEARISH";
}

export interface SelectPoisOptions {
  /** Current price (last close). Required for distance gating. */
  currentPrice?: number;
  /** ATR at last bar — used to express distance in ATR multiples. */
  atr?: number;
  /** Drop POIs farther than this many ATRs from `currentPrice`. */
  maxDistanceAtr?: number;
}

/**
 * Returns POI candidates ordered by priority, distance and quality.
 *
 * Gating applied here (defense-in-depth — the engine still re-validates):
 *  - Standalone FVG requires displacement evidence (parent OB).
 *  - When `currentPrice` is provided, POIs already overshot by price (price
 *    moved past the distal edge in the operational direction) are dropped.
 *  - When `currentPrice` + `atr` are provided, POIs farther than
 *    `maxDistanceAtr` are dropped.
 * Caller still gates entry/SL/TP/RR.
 */
export function selectPois(
  ict: IctContext,
  direction: SignalDirection,
  opts: SelectPoisOptions = {},
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

  // 4. Standalone FVGs — only when displacement evidence exists.
  const usedFvgIds = new Set(out.flatMap((p) => p.sourceIds));
  for (const f of fvgs) {
    if (usedFvgIds.has(f.id)) continue;
    if (!fvgHasDisplacement(f, ict.orderBlocks, direction)) continue;
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

  // Distance & overshoot gating.
  const price = opts.currentPrice;
  const atr = opts.atr;
  const maxDist = opts.maxDistanceAtr;
  const gated: SelectedPOI[] = [];
  for (const p of out) {
    if (price !== undefined && Number.isFinite(price)) {
      // Drop POIs already overshot (price past the distal edge in the trade direction).
      const past =
        direction === "long" ? price < Math.min(p.proximal, p.distal)
                              : price > Math.max(p.proximal, p.distal);
      if (past) continue;
      // Distance from price to proximal edge (0 when price is already inside the POI).
      const lo = Math.min(p.top, p.bottom);
      const hi = Math.max(p.top, p.bottom);
      const distPrice = price >= lo && price <= hi ? 0 : Math.min(Math.abs(price - p.proximal), Math.abs(price - p.distal));
      const distAtr = atr && atr > 0 ? distPrice / atr : null;
      p.distanceAtr = distAtr;
      if (maxDist !== undefined && distAtr !== null && distAtr > maxDist) continue;
    }
    gated.push(p);
  }

  gated.sort((a, b) => {
    const priority: Record<SelectedPOI["type"], number> = {
      OB_FVG_INTERSECTION: 3,
      OB: 2,
      FVG: 1,
    };
    if (priority[a.type] !== priority[b.type]) return priority[b.type] - priority[a.type];
    // Prefer closer POIs when both have a finite distance.
    const da = a.distanceAtr ?? null;
    const db = b.distanceAtr ?? null;
    if (da !== null && db !== null && da !== db) return da - db;
    return b.quality - a.quality;
  });
  return gated;
}