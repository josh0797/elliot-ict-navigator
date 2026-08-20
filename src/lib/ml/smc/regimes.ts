/**
 * SMC candidate regimes — two explicit, auditable classes.
 *
 * No Elliott dependency: regimes come purely from liquidity, displacement and
 * structure evidence available at the feature timestamp.
 */
import { buildSmcFeatures, resolveAtrValue } from "./features";
import type { SmcFeatureContext, SmcRegimeResult } from "./types";

const REVERSAL_THRESHOLD = 0.5;
const CONTINUATION_THRESHOLD = 0.5;
const RECENT_BARS = 6;
/** Body >= this many ATRs counts as displacement. */
const DISPLACEMENT_ATR = 1.0;

function indexOfTime(times: number[], time: number): number {
  for (let i = times.length - 1; i >= 0; i--) if (times[i] <= time) return i;
  return -1;
}

export function classifySmcRegime(ctx: SmcFeatureContext): SmcRegimeResult {
  const candles = ctx.candles ?? [];
  const n = candles.length;
  const atTime = Number.isFinite(ctx.atTime) ? ctx.atTime : (candles[n - 1]?.time ?? 0);
  const direction = ctx.direction === "short" ? "short" : "long";
  const dirSign = direction === "long" ? 1 : -1;
  const atr = resolveAtrValue(ctx.atr);
  const times = candles.map((c) => c.time);
  const anchorIndex = n - 1;
  const reasons: string[] = [];

  // --- liquidity evidence
  // A long reversal needs sell-side liquidity taken out (lows raided) and vice versa.
  const reversalSide = direction === "long" ? "SSL" : "BSL";
  const continuationSide = direction === "long" ? "BSL" : "SSL";
  const sweeps = (ctx.sweeps ?? []).filter((s) => Number.isFinite(s.time) && s.time <= atTime);
  const recent = sweeps.filter((s) => {
    const idx = Number.isFinite(s.index) ? s.index : indexOfTime(times, s.time);
    return idx >= 0 && anchorIndex - idx >= 0 && anchorIndex - idx <= RECENT_BARS;
  });
  const reversalSweeps = recent.filter((s) => s.side === reversalSide);
  const latestReversalSweep = reversalSweeps.length
    ? reversalSweeps.reduce((a, b) => (b.time >= a.time ? b : a))
    : null;
  const sweepAgainstDirection = !!latestReversalSweep;
  const sweepCloseBack = !!latestReversalSweep?.closeBack;
  const conflictingReversal = recent.some((s) => s.side === continuationSide && s.closeBack);

  // --- displacement evidence (strictly at/before atTime)
  const anchor = candles[anchorIndex] ?? null;
  const body = anchor ? (anchor.close - anchor.open) * dirSign : 0;
  const displacementBar = atr > 0 && body / atr >= DISPLACEMENT_ATR;
  const structureEvents = (ctx.structure ?? []).filter(
    (e) => e.state === "CONFIRMED" && Number.isFinite(e.time) && e.time <= atTime,
  );
  const latestEvent = structureEvents.length
    ? structureEvents.reduce((a, b) => (b.time >= a.time ? b : a))
    : null;
  const structureAligned = latestEvent?.direction === direction;
  const oppositeDisplacement =
    displacementBar ||
    (!!latestReversalSweep &&
      !!latestEvent &&
      latestEvent.direction === direction &&
      latestEvent.time >= latestReversalSweep.time);

  // --- momentum evidence
  const f = buildSmcFeatures(ctx).named;
  const velocity = f.velocity3_over_atr ?? 0;
  const bodyRatio = f.body_over_range ?? 0;
  const expansion = f.range_expansion_over_atr ?? 0;
  const directionalExpansion = velocity >= 0.6 && bodyRatio >= 0.45 && expansion >= 1.0;

  /* ---------- scoring ---------- */
  let reversal = 0;
  if (sweepAgainstDirection) {
    reversal += 0.4;
    reasons.push(`sweep_${reversalSide}_recent`);
  }
  if (sweepCloseBack) {
    reversal += 0.25;
    reasons.push("sweep_close_back");
  }
  if (oppositeDisplacement) {
    reversal += 0.25;
    reasons.push("opposite_displacement");
  }
  if (latestReversalSweep && latestReversalSweep.quality >= 60) {
    reversal += 0.1;
    reasons.push("sweep_quality_high");
  }

  let continuation = 0;
  if (directionalExpansion) {
    continuation += 0.45;
    reasons.push("directional_expansion");
  }
  if (structureAligned) {
    continuation += 0.3;
    reasons.push("structure_aligned");
  }
  if (displacementBar) {
    continuation += 0.15;
    reasons.push("displacement_bar");
  }
  if ((f.velocity5_over_atr ?? 0) >= 0.8) {
    continuation += 0.1;
    reasons.push("velocity5_strong");
  }
  if (conflictingReversal) {
    continuation -= 0.4;
    reasons.push("conflicting_reversal");
  }
  if (sweepAgainstDirection && sweepCloseBack) {
    continuation -= 0.2;
    reasons.push("fresh_reversal_signal");
  }

  const flags = {
    sweepAgainstDirection,
    sweepCloseBack,
    oppositeDisplacement,
    directionalExpansion,
    structureAligned: !!structureAligned,
    conflictingReversal,
  };

  const revOk = reversal >= REVERSAL_THRESHOLD && sweepAgainstDirection && sweepCloseBack;
  const contOk = continuation >= CONTINUATION_THRESHOLD && directionalExpansion;

  if (revOk && (!contOk || reversal >= continuation)) {
    return { regime: "LIQUIDITY_REVERSAL", confidence: Math.min(1, reversal), reasons, flags };
  }
  if (contOk) {
    return { regime: "MOMENTUM_CONTINUATION", confidence: Math.min(1, continuation), reasons, flags };
  }
  return {
    regime: "UNKNOWN",
    confidence: Math.max(0, Math.min(1, Math.max(reversal, continuation))),
    reasons: reasons.length ? reasons : ["insufficient_evidence"],
    flags,
  };
}
