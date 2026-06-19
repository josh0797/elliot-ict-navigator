import { buildICT } from "./ict";
import { countElliott } from "./elliott";
import { zigzag } from "./zigzag";
import type { Candle, TradeSetup } from "./types";

/**
 * Combines Elliott + ICT to produce a single (best) setup if confluence
 * exists in the most recent candles. Returns null otherwise.
 */
export function detectSetup(
  symbol: string,
  timeframe: string,
  candles: Candle[],
): TradeSetup | null {
  if (candles.length < 50) return null;
  const pivots = zigzag(candles, 0.0025);
  if (pivots.length < 6) return null;

  const wave = countElliott(pivots);
  const ict = buildICT(candles, pivots);
  if (!wave.valid) return null;

  const last = candles[candles.length - 1];
  const dir = wave.direction;

  // Look for OB / FVG that price is currently revisiting in the direction
  const candidatesOB = ict.orderBlocks.filter((ob) =>
    dir === "long" ? ob.type === "bullish" : ob.type === "bearish",
  );
  const candidatesFVG = ict.fvgs.filter((f) =>
    dir === "long" ? f.type === "bullish" : f.type === "bearish",
  );

  const nearOB = candidatesOB.reverse().find((ob) =>
    dir === "long" ? last.low <= ob.top && last.close >= ob.bottom : last.high >= ob.bottom && last.close <= ob.top,
  );
  const nearFVG = candidatesFVG.reverse().find((f) =>
    dir === "long" ? last.low <= f.top && last.close >= f.bottom : last.high >= f.bottom && last.close <= f.top,
  );

  const zone = nearOB ?? nearFVG;
  if (!zone) return null;

  // Confluence with recent BOS/CHoCH in same direction
  const struct = ict.structure.slice(-3).find((s) => s.direction === dir);
  const sweep = ict.sweeps.slice(-3).find((s) =>
    dir === "long" ? s.type === "sell_side" : s.type === "buy_side",
  );

  const entry = dir === "long" ? zone.top : zone.bottom;
  const sl = dir === "long" ? zone.bottom * 0.999 : zone.top * 1.001;

  // TP1 = 1.618 extension of wave 1 from wave 4 low; TP2 = recent opposite liquidity
  const w1Start = wave.pivots[0].price;
  const w1End = wave.pivots[1].price;
  const w4 = wave.pivots[4].price;
  const ext = Math.abs(w1End - w1Start) * 1.618;
  const tp1 = dir === "long" ? w4 + ext : w4 - ext;

  const oppPivots = wave.pivots.filter((p) => (dir === "long" ? p.type === "H" : p.type === "L"));
  const tp2 = oppPivots.length
    ? dir === "long"
      ? Math.max(...oppPivots.map((p) => p.price)) * 1.005
      : Math.min(...oppPivots.map((p) => p.price)) * 0.995
    : tp1 * (dir === "long" ? 1.01 : 0.99);

  // Heuristic score [0,1]
  let score = 0.4;
  if (nearOB) score += 0.2;
  if (nearFVG) score += 0.1;
  if (struct) score += 0.15;
  if (sweep) score += 0.15;
  if (wave.currentWave === "4" || wave.currentWave === "2") score += 0.05;
  score = Math.min(1, score);

  const r = Math.abs(entry - sl);
  if (r === 0) return null;
  const rr = Math.abs(tp1 - entry) / r;
  if (rr < 1.2) return null;

  const rationale = [
    `Elliott ${dir === "long" ? "alcista" : "bajista"} — onda actual ${wave.currentWave ?? "?"}.`,
    nearOB ? `Entrada en Order Block ${nearOB.type}.` : "",
    nearFVG ? `Coincide con FVG ${nearFVG.type}.` : "",
    struct ? `Confirmación de estructura ${struct.type}.` : "",
    sweep ? `Barrido de liquidez ${sweep.type === "buy_side" ? "buy-side" : "sell-side"}.` : "",
    `RR ≈ ${rr.toFixed(2)}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    symbol,
    timeframe,
    direction: dir,
    entry,
    sl,
    tp1,
    tp2,
    score,
    wave,
    ict,
    rationale,
    detectedAt: Math.floor(Date.now() / 1000),
  };
}