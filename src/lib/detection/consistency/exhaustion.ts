/**
 * Wave-termination evidence collector.
 *
 * Central rule: a Fibonacci target being reached NEVER means a wave ended.
 * Fibonacci defines a probable zone; price structure confirms termination.
 * We therefore require >= 2 independent exhaustion signals before a count may
 * be reported as COMPLETED.
 */
import type { CandleV2 } from "../schemas/analysis";
import type { IctContext } from "../ict/types";
import type { ElliottResultDTO, ExhaustionSignalCode } from "../elliott/types";
import { rsi, macd, hasDivergence } from "../indicators/momentum";
import { atr14 } from "../indicators/atr";

export interface ExhaustionInput {
  dto: ElliottResultDTO;
  candles?: ReadonlyArray<CandleV2>;
  ict?: IctContext | null;
  currentPrice: number;
  /** True when at least one Fibonacci target for the active wave was reached. */
  targetReached: boolean;
}

const MIN_SIGNALS = 2;

export function collectExhaustion(input: ExhaustionInput): ExhaustionSignalCode[] {
  const { dto, candles, ict, targetReached } = input;
  const out: ExhaustionSignalCode[] = [];
  const dir: "long" | "short" = dto.bias === "BEARISH" ? "short" : "long";

  if (targetReached) out.push("FIB_TARGET_REACHED");

  if (candles && candles.length >= 30) {
    const r = rsi(candles);
    if (hasDivergence(candles, r, dir)) out.push("RSI_DIVERGENCE");
    const m = macd(candles);
    if (hasDivergence(candles, m.histogram, dir)) out.push("MACD_DIVERGENCE");

    // Momentum loss: last 5-bar displacement clearly weaker than the previous 5.
    const n = candles.length;
    if (n >= 12) {
      const leg = (a: number, b: number) => Math.abs(candles[b].close - candles[a].close);
      const recent = leg(n - 6, n - 1);
      const prior = leg(n - 11, n - 6);
      if (prior > 0 && recent < prior * 0.5) out.push("MOMENTUM_LOSS");
    }

    // Structural rejection: long upper/lower wick beyond the extreme, closing back.
    const a = atr14(candles);
    const last = candles[n - 1];
    const atr = a[n - 1];
    if (Number.isFinite(atr) && atr > 0) {
      const wick =
        dir === "long"
          ? last.high - Math.max(last.open, last.close)
          : Math.min(last.open, last.close) - last.low;
      const body = Math.abs(last.close - last.open);
      if (wick > atr * 0.8 && wick > body) out.push("STRUCTURAL_REJECTION");
    }
  }

  // Counter BOS/CHoCH confirmed against the count direction.
  if (ict) {
    const counter = ict.structure.filter((e) => e.state === "CONFIRMED" && e.direction !== dir);
    const lastCounter = counter[counter.length - 1];
    if (lastCounter) {
      const horizon = (candles?.length ?? 0) - 20;
      if (!candles || lastCounter.index >= horizon) out.push("COUNTER_BOS_CHOCH");
    }
  }

  // Break of the last internal swing of wave 5 (its penultimate sub-pivot).
  const internal = dto.internal;
  if (internal && internal.waves.length >= 2) {
    const pivots = internal.waves;
    const lastSwing = pivots[pivots.length - 2];
    if (lastSwing) {
      const broken =
        dir === "long"
          ? input.currentPrice < lastSwing.price
          : input.currentPrice > lastSwing.price;
      if (broken) out.push("INTERNAL_SWING_BREAK");
    }
    // Five complete internal subwaves.
    const labels = new Set(pivots.map((p) => p.label));
    if (["1", "2", "3", "4", "5"].every((l) => labels.has(l as never))) {
      out.push("FIVE_SUBWAVES");
    }
  }

  return Array.from(new Set(out));
}

export function isTerminationConfirmed(signals: ReadonlyArray<ExhaustionSignalCode>): boolean {
  return signals.length >= MIN_SIGNALS;
}
