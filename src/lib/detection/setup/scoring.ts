/**
 * Canonical 0–100 setup score with per-confluence audit. Hard blockers
 * are NOT a points problem — engine handles them before this runs.
 */
import type { ElliottAnalysis } from "../elliott/types";
import type { IctContext } from "../ict/types";
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
  score: number;            // 0..100
  grade: ReturnType<typeof gradeFromScore>;
  confluences: ConfluenceAudit[];
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

  add("OB_VALID", poi.type === "OB" || poi.type === "OB_FVG_INTERSECTION", "OB válido");
  add("FVG_VALID", poi.type === "FVG" || poi.type === "OB_FVG_INTERSECTION", "FVG válido");
  add("OB_FVG_INTERSECTION", poi.type === "OB_FVG_INTERSECTION", "Intersección OB+FVG");

  if (ict.pdArray) {
    const aligned = (direction === "long" && ict.pdArray.zone === "DISCOUNT")
      || (direction === "short" && ict.pdArray.zone === "PREMIUM");
    add("PD_ALIGNED", aligned, `PD zone ${ict.pdArray.zone}`);
  } else {
    add("PD_ALIGNED", false, "Sin PD array");
  }

  add("KILLZONE_ACTIVE", !!ict.killzone, ict.killzone ? `Killzone ${ict.killzone.name}` : "Sin killzone");
  add("HTF_ALIGNED", false, "HTF no integrado todavía");

  const score = audit.reduce((s, a) => s + a.points, 0);
  return { score, grade: gradeFromScore(score), confluences: audit };
}