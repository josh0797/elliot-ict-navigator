/**
 * Canonical setup engine — combines Elliott v2 + ICT context into actionable
 * TradeSignals, then attaches a frozen legacy-pretrained-html-v1 ML score
 * in parallel (shadow). Pure function, no I/O.
 */

import { atr14 } from "../indicators/atr";
import type { CandleV2, PivotV2 } from "../schemas/analysis";
import type { ElliottAnalysis, ElliottCountV2 } from "../elliott/types";
import type { IctContext, LiquidityLevel, OrderBlock, FVG } from "../ict/types";
import { buildLegacyInput, scoreSignalLegacy } from "./legacyAdapter";
import type {
  ScoreBreakdown,
  SignalConfluence,
  SignalDirection,
  TradeSignal,
} from "./types";

const MIN_SCORE = 0.35;
const MIN_RR = 1.0;
const TOP_N = 3;
const SWEEP_RECENT_BARS = 5;
const SL_ATR_BUFFER = 0.1;

export interface SetupEngineOptions {
  symbol: string;
  timeframe: string;
  topN?: number;
  minScore?: number;
  minRR?: number;
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function priceAtLabel(count: ElliottCountV2, label: string): number | undefined {
  return count.labeled.find((l) => l.label === label)?.pivot.price;
}

function fib1618Target(count: ElliottCountV2, direction: SignalDirection): number | null {
  const p0 = priceAtLabel(count, "0");
  const p1 = priceAtLabel(count, "1");
  if (!isFinitePositive(p0) || !isFinitePositive(p1)) return null;
  const w1 = Math.abs(p1 - p0) * 1.618;
  const anchor = priceAtLabel(count, "4") ?? p1;
  return direction === "long" ? anchor + w1 : anchor - w1;
}

function nearestOppositeLiquidity(
  levels: ReadonlyArray<LiquidityLevel>,
  direction: SignalDirection,
  entry: number,
): LiquidityLevel | null {
  const wanted = direction === "long" ? "BSL" : "SSL";
  const above = direction === "long";
  const candidates = levels
    .filter((l) => l.state === "ACTIVE" && l.side === wanted)
    .filter((l) => (above ? l.price > entry : l.price < entry))
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  return candidates[0] ?? null;
}

function obToPoi(ob: OrderBlock, atr: number, direction: SignalDirection) {
  // entry = proximal edge of the OB w.r.t. current price reaction direction.
  // long: price drops INTO the OB from above → proximal = top, distal = bottom.
  // short: price rises INTO the OB from below → proximal = bottom, distal = top.
  const proximal = direction === "long" ? ob.top : ob.bottom;
  const distal = direction === "long" ? ob.bottom : ob.top;
  const buffer = atr * SL_ATR_BUFFER;
  const sl = direction === "long" ? distal - buffer : distal + buffer;
  return { entry: proximal, sl };
}

function fvgToPoi(f: FVG, atr: number, direction: SignalDirection) {
  const proximal = direction === "long" ? f.top : f.bottom;
  const distal = direction === "long" ? f.bottom : f.top;
  const buffer = atr * SL_ATR_BUFFER;
  const sl = direction === "long" ? distal - buffer : distal + buffer;
  return { entry: proximal, sl };
}

function inWaveEntryZone(label: string | null): boolean {
  if (!label) return false;
  return ["2", "4", "B"].includes(label);
}

/**
 * Compute confluences + canonical score (0..1) for a candidate POI.
 */
function computeConfluence(
  direction: SignalDirection,
  count: ElliottCountV2,
  ict: IctContext,
  poiKind: "ORDER_BLOCK" | "FVG",
  candleCount: number,
): { confluences: SignalConfluence[]; breakdown: ScoreBreakdown; score: number } {
  const cflu: SignalConfluence[] = [];

  // Bias alignment
  const biasDir = ict.bias === "BULLISH" ? "long" : ict.bias === "BEARISH" ? "short" : null;
  if (biasDir === direction) cflu.push("BIAS_ALIGN");

  // Wave entry zone
  if (inWaveEntryZone(count.currentWave)) cflu.push("WAVE_ENTRY_ZONE");

  // POI kind
  cflu.push(poiKind === "ORDER_BLOCK" ? "OB_CONFLUENCE" : "FVG_CONFLUENCE");

  // Recent sweep on the opposite side
  const recentSweepCutoff = candleCount - SWEEP_RECENT_BARS;
  const wantSweep = direction === "long" ? "sell_side" : "buy_side";
  if (ict.sweeps.some((s) => s.index >= recentSweepCutoff && s.type === wantSweep)) {
    cflu.push("SWEEP_RECENT");
  }

  // Structure confirmed in same direction (latest CONFIRMED event)
  const lastConfirmed = [...ict.structure].reverse().find((e) => e.state === "CONFIRMED");
  if (lastConfirmed && lastConfirmed.direction === direction) cflu.push("STRUCTURE_CONFIRMED");

  // Premium/Discount alignment
  if (ict.pdArray) {
    if (direction === "long" && ict.pdArray.zone === "DISCOUNT") cflu.push("PD_ALIGNED");
    if (direction === "short" && ict.pdArray.zone === "PREMIUM") cflu.push("PD_ALIGNED");
  }

  // Killzone (bonus)
  if (ict.killzone) cflu.push("KILLZONE_ACTIVE");

  // Score buckets.
  const elliottBucket = Math.max(0, Math.min(1, count.score));
  const ictBucket = Math.max(0, Math.min(1, ict.score));
  const flagWeights: Record<SignalConfluence, number> = {
    BIAS_ALIGN: 0.18,
    WAVE_ENTRY_ZONE: 0.18,
    OB_CONFLUENCE: 0.14,
    FVG_CONFLUENCE: 0.10,
    SWEEP_RECENT: 0.16,
    STRUCTURE_CONFIRMED: 0.14,
    PD_ALIGNED: 0.10,
    KILLZONE_ACTIVE: 0.06,
  };
  const confluenceBucket = Math.min(
    1,
    cflu.reduce((s, f) => s + flagWeights[f], 0),
  );

  const score = Math.max(0, Math.min(1,
    0.35 * elliottBucket + 0.25 * ictBucket + 0.40 * confluenceBucket,
  ));

  return {
    confluences: cflu,
    breakdown: { elliott: elliottBucket, ict: ictBucket, confluence: confluenceBucket },
    score,
  };
}

function buildRationale(
  direction: SignalDirection,
  count: ElliottCountV2,
  cflu: ReadonlyArray<SignalConfluence>,
  rr: number,
): string {
  const dirText = direction === "long" ? "alcista" : "bajista";
  const parts: string[] = [
    `Elliott ${dirText} (onda ${count.currentWave ?? "?"}, ${count.pattern}).`,
  ];
  if (cflu.includes("OB_CONFLUENCE")) parts.push("Entrada en Order Block.");
  if (cflu.includes("FVG_CONFLUENCE")) parts.push("Confluencia con FVG no mitigado.");
  if (cflu.includes("SWEEP_RECENT")) parts.push("Barrido de liquidez reciente.");
  if (cflu.includes("STRUCTURE_CONFIRMED")) parts.push("Estructura BOS/CHoCH confirmada.");
  if (cflu.includes("PD_ALIGNED")) parts.push(direction === "long" ? "Precio en discount." : "Precio en premium.");
  if (cflu.includes("KILLZONE_ACTIVE")) parts.push("Killzone activa.");
  parts.push(`RR≈${rr.toFixed(2)}.`);
  return parts.join(" ");
}

export function detectSignals(
  candles: ReadonlyArray<CandleV2>,
  _pivots: ReadonlyArray<PivotV2>,
  elliott: ElliottAnalysis,
  ict: IctContext,
  opts: SetupEngineOptions,
): TradeSignal[] {
  const primary = elliott.primary;
  if (!primary) return [];
  if (primary.state === "INVALIDATED") return [];
  if (candles.length === 0) return [];

  const direction = primary.direction;
  const atrSeries = atr14(candles);
  const lastAtrRaw = atrSeries[atrSeries.length - 1];
  const lastClose = candles[candles.length - 1].close;
  const lastAtr = Number.isFinite(lastAtrRaw) ? (lastAtrRaw as number) : lastClose * 0.005;
  if (!isFinitePositive(lastAtr) || !isFinitePositive(lastClose)) return [];

  const fibTp2 = fib1618Target(primary, direction);

  // Candidate POIs: OBs first (higher weight), then non-mitigated FVGs.
  type Candidate = {
    kind: "ORDER_BLOCK" | "FVG";
    id: string;
    entry: number;
    sl: number;
  };
  const candidates: Candidate[] = [];

  for (const ob of ict.orderBlocks) {
    const matches =
      (direction === "long" && ob.type === "BULLISH") ||
      (direction === "short" && ob.type === "BEARISH");
    if (!matches) continue;
    if (ob.state !== "FRESH" && ob.state !== "TOUCHED") continue;
    const { entry, sl } = obToPoi(ob, lastAtr, direction);
    candidates.push({ kind: "ORDER_BLOCK", id: ob.id, entry, sl });
  }

  for (const f of ict.fvgs) {
    const matches =
      (direction === "long" && f.type === "bullish") ||
      (direction === "short" && f.type === "bearish");
    if (!matches || f.mitigated) continue;
    const { entry, sl } = fvgToPoi(f, lastAtr, direction);
    candidates.push({ kind: "FVG", id: f.id, entry, sl });
  }

  const minScore = opts.minScore ?? MIN_SCORE;
  const minRR = opts.minRR ?? MIN_RR;
  const topN = opts.topN ?? TOP_N;

  const signals: TradeSignal[] = [];

  for (const cand of candidates) {
    const r = Math.abs(cand.entry - cand.sl);
    if (!isFinitePositive(r)) continue;

    // TP1: nearest opposite-side liquidity ACTIVE; else entry + 2R.
    const liq = nearestOppositeLiquidity(ict.liquidity, direction, cand.entry);
    const tp1 = liq
      ? liq.price
      : direction === "long" ? cand.entry + 2 * r : cand.entry - 2 * r;

    // TP2: fib 1.618 extension; else 3R fallback.
    const tp2 = fibTp2 ?? (direction === "long" ? cand.entry + 3 * r : cand.entry - 3 * r);

    const rr1 = Math.abs(tp1 - cand.entry) / r;
    const rr2 = Math.abs(tp2 - cand.entry) / r;
    if (rr1 < minRR) continue;

    const { confluences, breakdown, score } = computeConfluence(
      direction, primary, ict, cand.kind, candles.length,
    );
    if (score < minScore) continue;

    const confirmationLevel = cand.entry;
    const invalidationLevel = cand.sl;
    const fibTarget1 = tp2;
    const waveLabel = primary.currentWave;

    // Frozen legacy ML score (shadow, no operational gating).
    let mlScore: number | null = null;
    let modelVersion: string | null = null;
    try {
      const legacy = scoreSignalLegacy(buildLegacyInput(
        { confirmationLevel, invalidationLevel, fibTarget1, rrToTp1: rr1, waveLabel, entry: cand.entry },
        elliott,
        lastClose,
      ));
      mlScore = legacy.probability;
      modelVersion = legacy.schema;
    } catch {
      mlScore = null;
    }

    const finalScore = mlScore !== null ? 0.6 * score + 0.4 * mlScore : score;
    const rationale = buildRationale(direction, primary, confluences, rr1);

    signals.push({
      id: `${opts.symbol}-${opts.timeframe}-${cand.kind}-${cand.id}`,
      symbol: opts.symbol,
      timeframe: opts.timeframe,
      direction,
      entry: cand.entry,
      sl: cand.sl,
      tp1,
      tp2,
      confirmationLevel,
      invalidationLevel,
      fibTarget1,
      rrToTp1: rr1,
      rrToTp2: rr2,
      score,
      mlScore,
      modelVersion,
      finalScore,
      breakdown,
      confluences,
      poiKind: cand.kind,
      poiId: cand.id,
      waveLabel,
      rationale,
      detectedAt: Math.floor(Date.now() / 1000),
    });
  }

  signals.sort((a, b) => b.finalScore - a.finalScore);
  return signals.slice(0, topN);
}