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
import type { IctContext, LiquidityLevel, OrderBlock, FVG, StructureEvent, LiquiditySweep } from "../ict/types";
import { buildLegacyInput, scoreSignalLegacy } from "./legacyAdapter";
import type {
  OrderType,
  ScoreBreakdown,
  SetupStatus,
  SignalConfluence,
  SignalDirection,
  SLBasis,
  Tp1Source,
  Tp2Source,
  TradeSignal,
  TradeSetupV2,
} from "./types";

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
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function priceAtLabel(count: ElliottCountV2, label: string): number | undefined {
  return count.labeled.find((l) => l.label === label)?.pivot.price;
}

/**
 * Explicit 1.618 projection per current wave context.
 *   Wave 2 → project wave 3 from end of wave 1 (1.618 × |1-0|).
 *   Wave 4 → project wave 5 from end of wave 3 (1.618 × |3-2|).
 *   Wave B → project C from end of A (1.618 × |A-0|).
 * Returns the full source descriptor or null when pivots are missing.
 */
function fib1618Projection(
  count: ElliottCountV2,
  direction: SignalDirection,
): Extract<Tp2Source, { kind: "FIB_EXTENSION" }> | null {
  const cw = count.currentWave;
  const sign = direction === "long" ? 1 : -1;

  if (cw === "2") {
    const p0 = priceAtLabel(count, "0"); const p1 = priceAtLabel(count, "1");
    if (!isFinitePositive(p0) || !isFinitePositive(p1)) return null;
    const leg = Math.abs(p1 - p0);
    return { kind: "FIB_EXTENSION", wave: "3", from: p0, to: p1, projectedFrom: p1, ratio: 1.618 } as const;
    // projected price = p1 + sign * 1.618 * leg — used below.
  }
  if (cw === "4") {
    const p2 = priceAtLabel(count, "2"); const p3 = priceAtLabel(count, "3");
    if (!isFinitePositive(p2) || !isFinitePositive(p3)) return null;
    return { kind: "FIB_EXTENSION", wave: "5", from: p2, to: p3, projectedFrom: p3, ratio: 1.618 } as const;
  }
  if (cw === "B") {
    const pA0 = priceAtLabel(count, "0"); const pA = priceAtLabel(count, "A");
    if (!isFinitePositive(pA0) || !isFinitePositive(pA)) return null;
    return { kind: "FIB_EXTENSION", wave: "C", from: pA0, to: pA, projectedFrom: pA, ratio: 1.618 } as const;
  }
  // Other waves — leave to fallback.
  void sign;
  return null;
}

function evalFibProjection(src: Extract<Tp2Source, { kind: "FIB_EXTENSION" }>, direction: SignalDirection): number {
  const leg = Math.abs(src.to - src.from);
  return direction === "long" ? src.projectedFrom + 1.618 * leg : src.projectedFrom - 1.618 * leg;
}

/** Elliott invalidation level for the running count, given current wave. */
function elliottInvalidationLevel(count: ElliottCountV2, direction: SignalDirection): number | null {
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

function nearestOppositeLiquidity(
  levels: ReadonlyArray<LiquidityLevel>,
  direction: SignalDirection,
  entry: number,
  minRR: number,
  risk: number,
): LiquidityLevel | null {
  const wanted = direction === "long" ? "BSL" : "SSL";
  const above = direction === "long";
  const candidates = levels
    .filter((l) => l.state === "ACTIVE")
    .filter((l) => !l.provisional)
    .filter((l) => l.side === wanted)
    .filter((l) => (above ? l.price > entry : l.price < entry))
    .filter((l) => Math.abs(l.price - entry) / risk >= minRR)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  return candidates[0] ?? null;
}

function obToPoi(ob: OrderBlock, atr: number, direction: SignalDirection) {
  const proximal = direction === "long" ? ob.top : ob.bottom;
  const distal = direction === "long" ? ob.bottom : ob.top;
  return { proximal, distal, atrBuffer: atr * SL_ATR_BUFFER };
}

function fvgToPoi(f: FVG, atr: number, direction: SignalDirection) {
  const proximal = direction === "long" ? f.top : f.bottom;
  const distal = direction === "long" ? f.bottom : f.top;
  return { proximal, distal, atrBuffer: atr * SL_ATR_BUFFER };
}

function inWaveEntryZone(label: string | null): boolean {
  if (!label) return false;
  return ["2", "4", "B"].includes(label);
}

/**
 * Aggregate SL beyond every relevant structural level + ATR buffer.
 */
function computeSl(
  direction: SignalDirection,
  poiDistal: number,
  atrBuffer: number,
  elliottInv: number | null,
  sweepExtreme: number | null,
  protectedSwing: number | null,
): { sl: number; basis: SLBasis } {
  const parts = [poiDistal, elliottInv, sweepExtreme, protectedSwing].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const chosen: "max" | "min" = direction === "long" ? "min" : "max";
  const ext = direction === "long" ? Math.min(...parts) : Math.max(...parts);
  const sl = direction === "long" ? ext - atrBuffer : ext + atrBuffer;
  return {
    sl,
    basis: {
      elliottInvalidation: elliottInv,
      poiExtreme: poiDistal,
      sweepExtreme,
      protectedSwing,
      atrBuffer,
      chosen,
    },
  };
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

  const fibProj = fib1618Projection(primary, direction);
  const elliottInv = elliottInvalidationLevel(primary, direction);

  // Most recent sweep on the opposite side (for SL extreme).
  const wantSweepType = direction === "long" ? "sell_side" : "buy_side";
  const lastSweep = [...ict.sweeps].reverse().find((s) => s.type === wantSweepType) ?? null;
  const sweepExtreme = lastSweep ? lastSweep.price : null;
  const protectedSwing = recentSwingExtreme(pivots, direction, candles.length);

  // Candidate POIs: OBs first (higher weight), then non-mitigated FVGs.
  type Candidate = {
    kind: "ORDER_BLOCK" | "FVG";
    id: string;
    proximal: number;
    distal: number;
    atrBuffer: number;
    state: string;
  };
  const candidates: Candidate[] = [];

  for (const ob of ict.orderBlocks) {
    const matches =
      (direction === "long" && ob.type === "BULLISH") ||
      (direction === "short" && ob.type === "BEARISH");
    if (!matches) continue;
    // Gate 2: POI state must be active.
    if (ob.state !== "FRESH" && ob.state !== "TOUCHED") continue;
    const { proximal, distal, atrBuffer } = obToPoi(ob, lastAtr, direction);
    candidates.push({ kind: "ORDER_BLOCK", id: ob.id, proximal, distal, atrBuffer, state: ob.state });
  }

  for (const f of ict.fvgs) {
    const matches =
      (direction === "long" && f.type === "bullish") ||
      (direction === "short" && f.type === "bearish");
    if (!matches || f.mitigated) continue;
    const { proximal, distal, atrBuffer } = fvgToPoi(f, lastAtr, direction);
    candidates.push({ kind: "FVG", id: f.id, proximal, distal, atrBuffer, state: "FRESH" });
  }

  const minScore = opts.minScore ?? MIN_SCORE;
  const minRR = opts.minRR ?? MIN_RR;
  const topN = opts.topN ?? TOP_N;

  const setups: TradeSignal[] = [];

  for (const cand of candidates) {
    const entry = cand.proximal;

    // ── Entry classification (orderType / status / invalidation).
    const cls = classifyEntry(direction, cand.proximal, cand.distal, priceAtDetection);
    if (cls.invalidated) continue; // Gate: POI invalidated by price action.

    // ── SL aggregation across structural levels + ATR buffer.
    const { sl, basis } = computeSl(direction, cand.distal, cand.atrBuffer, elliottInv, sweepExtreme, protectedSwing);

    // Gate 3/4/6: finite + side + risk.
    if (!isFinitePositive(entry) || !Number.isFinite(sl)) continue;
    const risk = Math.abs(entry - sl);
    if (!isFinitePositive(risk)) continue;
    if (direction === "long" && !(sl < entry)) continue;
    if (direction === "short" && !(sl > entry)) continue;

    // ── TP1: eligible liquidity or 2R fallback.
    const liq = nearestOppositeLiquidity(ict.liquidity, direction, entry, minRR, risk);
    let tp1: number;
    let tp1Source: Tp1Source;
    if (liq) {
      tp1 = liq.price;
      tp1Source = { kind: "LIQUIDITY", liquidityId: liq.id, price: liq.price };
    } else {
      tp1 = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
      tp1Source = { kind: "FALLBACK", fallback: "2R" };
    }

    // Gate 5: TP1 side.
    if (direction === "long" && !(tp1 > entry)) continue;
    if (direction === "short" && !(tp1 < entry)) continue;

    // ── TP2: fib 1.618 explicit projection, else 3R.
    let tp2: number;
    let tp2Source: Tp2Source;
    if (fibProj) {
      const projected = evalFibProjection(fibProj, direction);
      const beyondTp1 = direction === "long" ? projected > tp1 : projected < tp1;
      if (Number.isFinite(projected) && beyondTp1) {
        tp2 = projected;
        tp2Source = fibProj;
      } else {
        tp2 = direction === "long" ? entry + 3 * risk : entry - 3 * risk;
        tp2Source = { kind: "FALLBACK", fallback: "3R" };
      }
    } else {
      tp2 = direction === "long" ? entry + 3 * risk : entry - 3 * risk;
      tp2Source = { kind: "FALLBACK", fallback: "3R" };
    }

    const rr1 = Math.abs(tp1 - entry) / risk;
    const rr2 = Math.abs(tp2 - entry) / risk;
    // Gate 7: RR.
    if (rr1 < minRR) continue;

    const { confluences, breakdown, score } = computeConfluence(
      direction, primary, ict, cand.kind, candles.length,
    );
    // STRUCTURE_CONFIRMED comes from latest CONFIRMED event — make sure the
    // structural confirmation gate appears in the audit.
    if (score < minScore) continue;

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

    const rationale = buildRationale(direction, primary, confluences, rr1);
    const setup: TradeSetupV2 = {
      schemaVersion: "canonical-setup-v2",
      id: `${opts.symbol}-${opts.timeframe}-${cand.kind}-${cand.id}`,
      symbol: opts.symbol,
      timeframe: opts.timeframe,
      direction,
      orderType: cls.orderType,
      status: cls.status,
      entry,
      sl,
      tp1,
      tp2,
      rrToTp1: rr1,
      rrToTp2: rr2,
      priceAtDetection,
      slBasis: basis,
      tp1Source,
      tp2Source,
      poi: { kind: cand.kind, id: cand.id, proximal: cand.proximal, distal: cand.distal, state: cand.state },
      score,
      mlScore,
      modelVersion,
      breakdown,
      confluences,
      gatesPassed,
      waveLabel,
      rationale,
      detectedAt: Math.floor(Date.now() / 1000),
    };
    // UI alias surface — operational score = canonical only.
    const signal: TradeSignal = {
      ...setup,
      finalScore: score,
      poiKind: cand.kind,
      poiId: cand.id,
    };
    setups.push(signal);
  }

  setups.sort((a, b) => b.score - a.score);
  return setups.slice(0, topN);
}