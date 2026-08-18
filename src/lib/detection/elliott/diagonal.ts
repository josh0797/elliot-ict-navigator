/**
 * Ending Diagonal (terminal diagonal / wedge) detection.
 *
 * An ending diagonal is the ONLY Elliott pattern where wave-4 overlap into
 * wave-1 territory is REQUIRED, not forbidden. It appears in wave 5 of an
 * impulse or wave C of a correction, and its completion + trendline break
 * is one of the highest-probability reversal setups.
 *
 * Bearish ending diagonal (reversal → LONG):
 *   pivots  L1 > L3 > L5 (lower lows) on the support line 1-3-5
 *   pivots  H2 > H4       (lower highs) on the resistance line 2-4
 *   both lines slope DOWN and CONVERGE
 *   trigger: close ABOVE the 2-4 line after pivot 5 forms
 *
 * Bullish ending diagonal (reversal → SHORT) is the mirror image.
 *
 * Quality scoring favours:
 *   - wave-3 not the shortest (guideline still applies inside diagonals)
 *   - decreasing wave sizes (1 > 3 > 5 contraction)
 *   - throw-over of wave 5 beyond the 1-3 line (exhaustion signature)
 *   - convergence angle (tight wedges score higher)
 */
import type { CandleV2, PivotV2 } from "../schemas/analysis";

export interface TrendLine {
  /** price = slope * index + intercept */
  slope: number;
  intercept: number;
}

export interface DiagonalPattern {
  type: "ENDING_DIAGONAL";
  /** Direction of the EXPECTED REVERSAL after completion. */
  reversalDirection: "long" | "short";
  /** The five wave-terminal pivots in order [w1, w2, w3, w4, w5]. */
  pivots: [PivotV2, PivotV2, PivotV2, PivotV2, PivotV2];
  /** Line through wave-2 / wave-4 terminals (the breakout line). */
  line24: TrendLine;
  /** Line through wave-1 / wave-3 (and ideally wave-5) terminals. */
  line13: TrendLine;
  /** Current value of the 2-4 line at the last candle (breakout level). */
  breakoutLevel: number;
  /** True when a candle CLOSED beyond the 2-4 line after pivot 5. */
  brokenOut: boolean;
  breakoutIndex: number | null;
  /** True when wave 5 pierced the 1-3 line (throw-over / exhaustion). */
  throwOver: boolean;
  /** 0..100 composite quality. */
  quality: number;
}

function lineThrough(aIdx: number, aPrice: number, bIdx: number, bPrice: number): TrendLine {
  const slope = (bPrice - aPrice) / Math.max(1, bIdx - aIdx);
  return { slope, intercept: aPrice - slope * aIdx };
}

function valueAt(line: TrendLine, index: number): number {
  return line.slope * index + line.intercept;
}

export interface DetectDiagonalOptions {
  /** Max pivots back to scan (default 30 confirmed pivots). */
  lookbackPivots?: number;
  /** Require wave sizes to contract (1 > 3 > 5)? Default false (guideline, not rule). */
  strictContraction?: boolean;
}

/**
 * Scans the confirmed pivot sequence for the most recent completed ending
 * diagonal. Returns null when none is present.
 */
export function detectEndingDiagonal(
  pivots: ReadonlyArray<PivotV2>,
  candles: ReadonlyArray<CandleV2>,
  opts: DetectDiagonalOptions = {},
): DiagonalPattern | null {
  const lookback = opts.lookbackPivots ?? 30;
  // Accept the provisional tail pivot for wave-5: when the breakout already
  // closed beyond the 2-4 line, waiting for the right-bar confirmation window
  // would miss the trade. Waves 1-4 are still required to be confirmed.
  const scan = pivots.slice(-lookback);
  if (scan.length < 5 || candles.length < 10) return null;

  // Try the most recent window first: scan backwards over 5-pivot windows.
  for (let end = scan.length - 1; end >= 4; end--) {
    const w = scan.slice(end - 4, end + 1);
    // Require w1..w4 confirmed; w5 may be provisional (validated by breakout).
    if (!w[0].confirmed || !w[1].confirmed || !w[2].confirmed || !w[3].confirmed) continue;

    const bearish = tryDiagonal(w, candles, "long", opts); // falling wedge → LONG reversal
    if (bearish) return bearish;

    const bullish = tryDiagonal(w, candles, "short", opts); // rising wedge → SHORT reversal
    if (bullish) return bullish;
  }
  return null;
}

function tryDiagonal(
  w: PivotV2[],
  candles: ReadonlyArray<CandleV2>,
  reversal: "long" | "short",
  opts: DetectDiagonalOptions,
): DiagonalPattern | null {
  const [p1, p2, p3, p4, p5] = w;

  if (reversal === "long") {
    // Falling wedge: L-H-L-H-L with lower lows and lower highs.
    if (
      p1.type !== "LOW" ||
      p2.type !== "HIGH" ||
      p3.type !== "LOW" ||
      p4.type !== "HIGH" ||
      p5.type !== "LOW"
    )
      return null;
    if (!(p3.price < p1.price && p5.price < p3.price)) return null; // lower lows
    if (!(p4.price < p2.price)) return null; // lower highs
  } else {
    // Rising wedge: H-L-H-L-H with higher highs and higher lows.
    if (
      p1.type !== "HIGH" ||
      p2.type !== "LOW" ||
      p3.type !== "HIGH" ||
      p4.type !== "LOW" ||
      p5.type !== "HIGH"
    )
      return null;
    if (!(p3.price > p1.price && p5.price > p3.price)) return null; // higher highs
    if (!(p4.price > p2.price)) return null; // higher lows
  }

  // Wave-3 must not be the shortest (holds inside diagonals too).
  const len1 = Math.abs(p2.price - p1.price);
  const len3 = Math.abs(p4.price - p3.price);
  const len5 = Math.abs(p5.price - p4.price);
  if (len3 < len1 && len3 < len5) return null;

  // Optional contraction guideline: 1 > 3 > 5.
  const contracting = len1 > len3 && len3 > len5;
  if (opts.strictContraction && !contracting) return null;

  // Trendlines.
  const line24 = lineThrough(p2.index, p2.price, p4.index, p4.price);
  const line13 = lineThrough(p1.index, p1.price, p3.index, p3.price);

  // Both lines must slope in the direction of the terminal move and CONVERGE.
  if (reversal === "long") {
    if (line24.slope >= 0 || line13.slope >= 0) return null; // both falling
    if (line24.slope >= line13.slope) return null; // 2-4 steeper → converging
  } else {
    if (line24.slope <= 0 || line13.slope <= 0) return null; // both rising
    if (line24.slope <= line13.slope) return null; // 2-4 steeper → converging
  }

  // Wave-5 throw-over: pivot 5 beyond the 1-3 line (exhaustion bonus).
  const line13AtP5 = valueAt(line13, p5.index);
  const throwOver = reversal === "long" ? p5.price < line13AtP5 : p5.price > line13AtP5;

  // Breakout: a candle CLOSING beyond the 2-4 line after pivot 5.
  let brokenOut = false;
  let breakoutIndex: number | null = null;
  for (let k = p5.index + 1; k < candles.length; k++) {
    const lvl = valueAt(line24, k);
    const c = candles[k];
    const closedBeyond = reversal === "long" ? c.close > lvl : c.close < lvl;
    if (closedBeyond) {
      brokenOut = true;
      breakoutIndex = k;
      break;
    }
    // Invalidation: new extreme beyond pivot 5 kills the count.
    const invalidated = reversal === "long" ? c.low < p5.price : c.high > p5.price;
    if (invalidated) return null;
  }

  const lastIdx = candles.length - 1;
  const breakoutLevel = valueAt(line24, lastIdx);

  // Provisional wave-5 is only accepted when the breakout has already closed
  // beyond the 2-4 line — otherwise the pattern is unconfirmed by structure.
  if (!p5.confirmed && !brokenOut) return null;

  // Quality: base 55, +15 throw-over, +15 contraction, +15 tight convergence.
  const spreadStart = Math.abs(valueAt(line24, p1.index) - valueAt(line13, p1.index));
  const spreadEnd = Math.abs(valueAt(line24, p5.index) - valueAt(line13, p5.index));
  const convergenceRatio = spreadStart > 0 ? 1 - spreadEnd / spreadStart : 0;
  let quality = 55;
  if (throwOver) quality += 15;
  if (contracting) quality += 15;
  quality += Math.round(Math.min(1, Math.max(0, convergenceRatio)) * 15);

  return {
    type: "ENDING_DIAGONAL",
    reversalDirection: reversal,
    pivots: [p1, p2, p3, p4, p5],
    line24,
    line13,
    breakoutLevel,
    brokenOut,
    breakoutIndex,
    throwOver,
    quality: Math.min(100, quality),
  };
}
