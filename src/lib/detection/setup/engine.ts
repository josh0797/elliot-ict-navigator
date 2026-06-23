/**
 * Canonical setup engine — combines Elliott v2 + ICT context into actionable
 * TradeSetupV2 snapshots. Applies hard gates BEFORE scoring; the canonical
 * score is a tiebreaker, never a gate substitute. The frozen legacy
 * pretrained ML score is attached in parallel (ACTIVE BASELINE diagnostic).
 * Pure function, no I/O.
 */

import { atr14 } from "../indicators/atr";
import type { CandleV2, PivotV2 } from "../schemas/analysis";
import type { ElliottAnalysis, ElliottCountV2 } from "../elliott/types";
import type { IctContext, StructureEvent, LiquiditySweep } from "../ict/types";
import { buildLegacyInput, scoreSignalLegacy } from "./legacyAdapter";
import type {
  OrderType,
  ScoreBreakdown,
  SetupStatus,
  SignalConfluence,
  SignalDirection,
  Tp1Source,
  TradeSignal,
  TradeSetupV2,
} from "./types";
import { resolveConfig, type SetupConfig } from "./config";
import { selectPois, type SelectedPOI } from "./poi-selector";
import { computeStopLoss } from "./risk";
import { pickTargets, legacyTp2Source, type TargetSpec } from "./targets";
import { computeScore } from "./scoring";
import { deriveTrigger } from "./trigger";

const MIN_SCORE = 0.35;
const MIN_RR = 1.0;
const TOP_N = 3;
const SWEEP_RECENT_BARS = 5;
const SL_ATR_BUFFER = 0.1;
const STRUCTURE_RECENT_BARS = 20;

export interface SetupEngineOptions {
  symbol: string;
  timeframe: string;
  topN?: number;
  minScore?: number;
  minRR?: number;
  config?: Partial<SetupConfig>;
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function priceAtLabel(count: ElliottCountV2, label: string): number | undefined {
  return count.labeled.find((l) => l.label === label)?.pivot.price;
}

/** Elliott invalidation level for the running count, given current wave. */
function elliottInvalidationLevel(count: ElliottCountV2, direction: SignalDirection): number | null {
  void direction;
  // Long impulse: wave 2 cannot retrace below wave 0. Wave 4 cannot enter wave 1.
  const p0 = priceAtLabel(count, "0");
  if (count.currentWave === "2" && isFinitePositive(p0)) return p0!;
  if (count.currentWave === "4") {
    const p1 = priceAtLabel(count, "1");
    if (isFinitePositive(p1)) return p1!;
  }
  // Default: protected origin.
  return isFinitePositive(p0) ? p0! : null;
}

function recentSwingExtreme(
  pivots: ReadonlyArray<PivotV2>,
  direction: SignalDirection,
  beforeIndex: number,
): number | null {
  // Last confirmed pivot opposite to direction (long → recent LOW, short → recent HIGH).
  const want = direction === "long" ? "LOW" : "HIGH";
  for (let i = pivots.length - 1; i >= 0; i--) {
    const p = pivots[i];
    if (p.index >= beforeIndex) continue;
    if (!p.confirmed) continue;
    if (p.type === want) return p.price;
  }
  return null;
}

function inWaveEntryZone(label: string | null): boolean {
  if (!label) return false;
  return ["2", "4", "B"].includes(label);
}

/**
 * Determine order type + status from price position relative to the POI.
 */
function classifyEntry(
  direction: SignalDirection,
  proximal: number,
  distal: number,
  price: number,
): { orderType: OrderType; status: SetupStatus; invalidated: boolean } {
  // Long: POI is below price normally; price falls INTO it [distal..proximal] (distal<proximal).
  // Short: POI above; price rises INTO it [proximal..distal] (proximal<distal).
  const lo = Math.min(proximal, distal);
  const hi = Math.max(proximal, distal);
  const inside = price >= lo && price <= hi;
  if (inside) {
    return {
      orderType: direction === "long" ? "MARKET_BUY" : "MARKET_SELL",
      status: "TRIGGERED",
      invalidated: false,
    };
  }
  if (direction === "long") {
    if (price < lo) {
      // POI already overshot to the downside (price went past distal) → invalid.
      return { orderType: "NO_ORDER", status: "INVALIDATED", invalidated: true };
    }
    return { orderType: "BUY_LIMIT", status: "WAITING_RETRACE", invalidated: false };
  } else {
    if (price > hi) {
      return { orderType: "NO_ORDER", status: "INVALIDATED", invalidated: true };
    }
    return { orderType: "SELL_LIMIT", status: "WAITING_RETRACE", invalidated: false };
  }
}

/** Structural confirmation gate: BOS/CHoCH CONFIRMED recently OR valid sweep+displacement. */
function structuralConfirmation(
  ict: IctContext,
  direction: SignalDirection,
  candleCount: number,
): { ok: boolean; via: "BOS_CHOCH" | "SWEEP_DISPLACEMENT" | null } {
  const cutoff = candleCount - STRUCTURE_RECENT_BARS;
  const bos = [...ict.structure].reverse().find(
    (e: StructureEvent) =>
      e.state === "CONFIRMED" && e.direction === direction && e.index >= cutoff,
  );
  if (bos) return { ok: true, via: "BOS_CHOCH" };

  const wantSweep = direction === "long" ? "sell_side" : "buy_side";
  const sw = [...ict.sweeps].reverse().find(
    (s: LiquiditySweep) =>
      s.type === wantSweep && s.wickBeyond && s.closeBack && s.displacementAfter,
  );
  if (sw) return { ok: true, via: "SWEEP_DISPLACEMENT" };

  return { ok: false, via: null };
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
  pivots: ReadonlyArray<PivotV2>,
  elliott: ElliottAnalysis,
  ict: IctContext,
  opts: SetupEngineOptions,
): TradeSignal[] {
  const config = resolveConfig(opts.config);
  // ── Gate 1: Elliott primary exists and is not INVALIDATED.
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

  const priceAtDetection = candles.length >= 2
    ? candles[candles.length - 2].close
    : lastClose;

  // ── Gate 10: structural confirmation is required (BOS/CHoCH or sweep+displacement).
  const conf = structuralConfirmation(ict, direction, candles.length);
  if (!conf.ok) return [];

  const elliottInv = elliottInvalidationLevel(primary, direction);

  // Most recent sweep on the opposite side (for SL extreme).
  const wantSweepType = direction === "long" ? "sell_side" : "buy_side";
  const lastSweep = [...ict.sweeps].reverse().find((s) => s.type === wantSweepType) ?? null;
  const sweepExtreme = lastSweep ? lastSweep.price : null;
  const protectedSwing = recentSwingExtreme(pivots, direction, candles.length);

  // ── Phase 6: ranked POI candidates from selector.
  const pois = selectPois(ict, direction);

  const minScore = opts.minScore ?? MIN_SCORE;
  const minRR = opts.minRR ?? MIN_RR;
  const topN = opts.topN ?? config.topN;

  const setups: TradeSignal[] = [];

  for (const poi of pois) {
    // Phase 9 entry: proximal of OB; consequent encroachment of FVG; midpoint of intersection.
    const entry =
      poi.type === "OB_FVG_INTERSECTION" ? poi.midpoint
      : poi.type === "FVG" ? poi.midpoint
      : poi.proximal;
    const entryPolicy =
      poi.type === "OB_FVG_INTERSECTION" ? "OB_FVG_INTERSECTION"
      : poi.type === "FVG" ? "FVG_CE"
      : "OB_PROXIMAL";
    const candKind: "ORDER_BLOCK" | "FVG" =
      poi.type === "FVG" ? "FVG" : "ORDER_BLOCK";

    // ── Entry classification (orderType / status / invalidation).
    const cls = classifyEntry(direction, poi.proximal, poi.distal, priceAtDetection);
    if (cls.invalidated) continue; // Gate: POI invalidated by price action.

    // ── SL aggregation across structural levels + ATR buffer.
    const slRes = computeStopLoss({
      direction,
      poiDistal: poi.distal,
      atr: lastAtr,
      atrBufferMultiplier: config.slAtrBufferMultiplier,
      elliottInvalidation: elliottInv,
      sweepExtreme,
      protectedSwing,
    });
    const sl = slRes.price;
    const basis = slRes.basis;

    // Gate 3/4/6: finite + side + risk.
    if (!isFinitePositive(entry) || !Number.isFinite(sl)) continue;
    const risk = Math.abs(entry - sl);
    if (!isFinitePositive(risk)) continue;
    if (direction === "long" && !(sl < entry)) continue;
    if (direction === "short" && !(sl > entry)) continue;

    // ── Targets ladder (TP1/TP2/TP3).
    const targets: TargetSpec[] = pickTargets({
      direction, entry, risk, minRR,
      liquidity: ict.liquidity, primary, allocations: config.allocations,
    });
    const tp1 = targets[0]?.price ?? NaN;
    const tp2 = targets[1]?.price ?? NaN;
    const rr1 = targets[0]?.rr ?? 0;
    const rr2 = targets[1]?.rr ?? 0;
    const tp1Source: Tp1Source =
      targets[0]?.source.kind === "LIQUIDITY"
        ? { kind: "LIQUIDITY", liquidityId: targets[0].source.liquidityId, price: tp1 }
        : { kind: "FALLBACK", fallback: "2R" };
    const tp2Source = legacyTp2Source(targets[1]);

    // Gate 5: TP1 side.
    if (direction === "long" && !(tp1 > entry)) continue;
    if (direction === "short" && !(tp1 < entry)) continue;

    // Gate 7: RR.
    if (rr1 < minRR) continue;

    const { confluences, breakdown, score } = computeConfluence(
      direction, primary, ict, candKind, candles.length,
    );
    if (score < minScore) continue;

    // Canonical 0..100 score + per-confluence audit.
    const scoreCanon = computeScore({
      direction, elliott, ict, poi,
      weights: config.weights, recentBars: config.recentBars, candleCount: candles.length,
    });

    const waveLabel = primary.currentWave;

    // Frozen legacy ML score — ACTIVE BASELINE, parallel diagnostic only.
    let mlScore: number | null = null;
    let modelVersion: string | null = null;
    try {
      const legacy = scoreSignalLegacy(buildLegacyInput(
        { confirmationLevel: entry, invalidationLevel: sl, fibTarget1: tp1, rrToTp1: rr1, waveLabel, entry },
        elliott,
        priceAtDetection,
      ));
      mlScore = legacy.probability;
      modelVersion = legacy.schema;
    } catch {
      mlScore = null;
    }

    const gatesPassed = [
      "ELLIOTT_PRIMARY",
      "POI_ACTIVE",
      "FINITE_LEVELS",
      "SL_SIDE",
      "TP1_SIDE",
      "RISK_POSITIVE",
      `RR_GE_${minRR}`,
      "POI_NOT_INVALIDATED",
      "CONFIRMED_PIVOTS",
      `STRUCTURAL_CONFIRMATION:${conf.via}`,
    ];

    const entryZone = { top: Math.max(poi.top, poi.bottom), bottom: Math.min(poi.top, poi.bottom) };
    const trigger = deriveTrigger({
      direction, orderType: cls.orderType, entry, entryZone, currentPrice: lastClose,
    });

    const nextAction = trigger.satisfied
      ? `Ejecutar ${cls.orderType} en ${entry.toFixed(5)} con SL ${sl.toFixed(5)}.`
      : trigger.description;

    const invalidationReason =
      slRes.reason === "ELLIOTT_INVALIDATION" ? "Invalidación Elliott rota"
      : slRes.reason === "BEYOND_SWEEP" ? "Estructura del sweep rota"
      : slRes.reason === "BEYOND_PROTECTED_SWING" ? "Swing protegido perforado"
      : "Distal del POI perforado";

    const rationale = buildRationale(direction, primary, confluences, rr1);
    const setupId = `${opts.symbol}-${opts.timeframe}-${poi.type}-${poi.sourceIds.join("_")}`;
    const setup: TradeSetupV2 = {
      schemaVersion: "canonical-setup-v2",
      id: setupId,
      setupKey: setupId,
      symbol: opts.symbol,
      timeframe: opts.timeframe,
      direction,
      directionUpper: direction === "long" ? "LONG" : "SHORT",
      orderType: cls.orderType,
      status: cls.status,
      entry,
      sl,
      tp1,
      tp2,
      rrToTp1: rr1,
      rrToTp2: rr2,
      entryZone,
      entryPolicy,
      stopReason: slRes.reason,
      targets,
      selectedPoi: poi as SelectedPOI,
      trigger,
      priceAtDetection,
      slBasis: basis,
      tp1Source,
      tp2Source,
      poi: { kind: candKind, id: poi.sourceIds[0], proximal: poi.proximal, distal: poi.distal, state: poi.type },
      score,
      scoreOut100: scoreCanon.score,
      grade: scoreCanon.grade,
      hardBlockers: [],
      warnings: [],
      mlScore,
      modelVersion,
      breakdown,
      confluences,
      confluencesDetail: scoreCanon.confluences,
      gatesPassed,
      waveLabel,
      rationale,
      nextAction,
      invalidation: { price: sl, reason: invalidationReason },
      detectedAt: Math.floor(Date.now() / 1000),
      expiresAt: null,
    };
    // UI alias surface — operational score = canonical only.
    const signal: TradeSignal = {
      ...setup,
      finalScore: score,
      poiKind: candKind,
      poiId: poi.sourceIds[0],
    };
    setups.push(signal);
  }

  setups.sort((a, b) => b.score - a.score);
  return setups.slice(0, topN);
}