/**
 * Canonical 0–100 setup score with per-confluence audit. Hard blockers
 * are NOT a points problem — engine handles them before this runs.
 */
import type { ElliottAnalysis } from "../elliott/types";
import type { IctContext, OrderBlock, FVG } from "../ict/types";
import type { ScoreWeights } from "./config";
import { gradeFromScore } from "./config";
import type { SelectedPOI } from "./poi-selector";
import type { SignalDirection } from "./types";

export interface ConfluenceAudit {
  code: keyof ScoreWeights;
  active: boolean;
  points: number;
  reason: string;
}

export interface ScoreResult {
  /** Final clamped 0..100 score. */
  score: number;
  /** Raw unclamped sum of awarded weights (diagnostic). */
  rawScore: number;
  /** Sum of all enabled weights — the ceiling if every confluence fires. */
  maxAvailableScore: number;
  grade: ReturnType<typeof gradeFromScore>;
  confluences: ConfluenceAudit[];
}

const SCORE_FLOOR = 0;
const SCORE_CEIL = 100;

function validateWeights(weights: ScoreWeights): number {
  let max = 0;
  for (const [k, v] of Object.entries(weights)) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`computeScore: invalid weight for ${k} (${v}); must be finite ≥ 0`);
    }
    max += v;
  }
  return max;
}

function obStillValid(ict: IctContext, ids: ReadonlyArray<string>): boolean {
  return ids.some((id) => {
    const ob: OrderBlock | undefined = ict.orderBlocks.find((o) => o.id === id);
    return !!ob && (ob.state === "FRESH" || ob.state === "TOUCHED");
  });
}
function fvgStillValid(ict: IctContext, ids: ReadonlyArray<string>): boolean {
  return ids.some((id) => {
    const f: FVG | undefined = ict.fvgs.find((x) => x.id === id);
    return !!f && !f.mitigated;
  });
}

export function computeScore(args: {
  direction: SignalDirection;
  elliott: ElliottAnalysis;
  ict: IctContext;
  poi: SelectedPOI;
  weights: ScoreWeights;
  recentBars: number;
  candleCount: number;
}): ScoreResult {
  const { direction, elliott, ict, poi, weights, recentBars, candleCount } = args;
  const maxAvailableScore = validateWeights(weights);
  const cutoff = candleCount - recentBars;
  const audit: ConfluenceAudit[] = [];

  const add = (code: keyof ScoreWeights, active: boolean, reason: string) => {
    audit.push({ code, active, points: active ? weights[code] : 0, reason });
  };

  const primary = elliott.primary;
  add("ELLIOTT_ALIGNED",
    !!primary && primary.state !== "INVALIDATED" && primary.direction === direction,
    `Primary ${primary?.pattern ?? "?"} ${primary?.direction ?? "?"} W${primary?.currentWave ?? "?"}`);

  add("ICT_BIAS_ALIGNED",
    (ict.bias === "BULLISH" && direction === "long") || (ict.bias === "BEARISH" && direction === "short"),
    `ICT bias ${ict.bias}`);

  const wantSweep = direction === "long" ? "sell_side" : "buy_side";
  add("SWEEP_OPPOSITE_RECENT",
    ict.sweeps.some((s) => s.type === wantSweep && s.index >= cutoff && s.wickBeyond && s.closeBack),
    "Sweep opuesto reciente");

  const lastChoch = [...ict.structure].reverse().find((e) => e.type === "CHoCH" && e.state === "CONFIRMED" && e.index >= cutoff);
  add("CHOCH_CONFIRMED", !!lastChoch && lastChoch.direction === direction, `CHoCH ${lastChoch?.direction ?? "?"}`);

  const lastBos = [...ict.structure].reverse().find((e) => e.type === "BOS" && e.state === "CONFIRMED" && e.index >= cutoff);
  add("BOS_DISPLACEMENT", !!lastBos && lastBos.direction === direction && lastBos.displacement, `BOS displacement ${lastBos?.direction ?? "?"}`);

  // POI type alone is NOT enough — re-verify the source object is still active.
  const obKind = poi.type === "OB" || poi.type === "OB_FVG_INTERSECTION";
  const fvgKind = poi.type === "FVG" || poi.type === "OB_FVG_INTERSECTION";
  const obAlive = obKind && obStillValid(ict, poi.sourceIds);
  const fvgAlive = fvgKind && fvgStillValid(ict, poi.sourceIds);
  add("OB_VALID", obAlive, obAlive ? "OB activo (FRESH/TOUCHED)" : "OB no activo");
  add("FVG_VALID", fvgAlive, fvgAlive ? "FVG activo (no mitigado)" : "FVG no activo");
  add("OB_FVG_INTERSECTION", poi.type === "OB_FVG_INTERSECTION" && obAlive && fvgAlive, "Intersección OB+FVG");

  if (ict.pdArray) {
    const aligned = (direction === "long" && ict.pdArray.zone === "DISCOUNT")
      || (direction === "short" && ict.pdArray.zone === "PREMIUM");
    add("PD_ALIGNED", aligned, `PD zone ${ict.pdArray.zone}`);
  } else {
    add("PD_ALIGNED", false, "Sin PD array");
  }

  add("KILLZONE_ACTIVE", !!ict.killzone, ict.killzone ? `Killzone ${ict.killzone.name}` : "Sin killzone");
  add("HTF_ALIGNED", false, "HTF no integrado todavía");

  const rawScore = audit.reduce((s, a) => s + a.points, 0);
  const score = Math.max(SCORE_FLOOR, Math.min(SCORE_CEIL, rawScore));
  return { score, rawScore, maxAvailableScore, grade: gradeFromScore(score), confluences: audit };
}