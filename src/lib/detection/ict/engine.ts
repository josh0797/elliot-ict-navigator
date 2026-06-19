import type { CandleV2, PivotV2 } from "../schemas/analysis";
import { currentBias } from "../structure/market-structure";
import { detectFVGs } from "./fvg";
import { detectOrderBlocks } from "./orderBlocks";
import { detectLiquidity } from "./liquidity";
import { detectSweeps } from "./sweeps";
import { detectStructure } from "./structure";
import { currentKillzone } from "./killzones";
import { computePdArray } from "./pdArray";
import type { IctContext } from "./types";

export function analyzeIct(candles: ReadonlyArray<CandleV2>, pivots: ReadonlyArray<PivotV2>): IctContext {
  const fvgs = detectFVGs(candles);
  const structure = detectStructure(pivots);
  const orderBlocks = detectOrderBlocks(candles, fvgs, structure);
  const liquidity = detectLiquidity(pivots, candles);
  const sweeps = detectSweeps(candles, liquidity, structure);
  const bias = currentBias(pivots);
  const killzone = candles.length ? currentKillzone(candles[candles.length - 1].time) : null;
  const pdArray = computePdArray(candles);

  let score = 0.4;
  const lastStruct = structure[structure.length - 1];
  if (lastStruct) {
    if ((bias === "BULLISH" && lastStruct.direction === "long") || (bias === "BEARISH" && lastStruct.direction === "short")) {
      score += 0.2;
    }
  }
  const recent = sweeps.filter((s) => s.index >= candles.length - 5);
  if (recent.length > 0) {
    const best = recent.reduce((m, s) => (s.quality > m ? s.quality : m), 0);
    score += 0.05 + 0.15 * (best / 100);
  }
  if (fvgs.some((f) => !f.mitigated)) score += 0.1;
  if (orderBlocks.some((ob) => ob.state === "FRESH" || ob.state === "TOUCHED")) score += 0.15;
  score = Math.min(1, score);

  return { bias, fvgs, orderBlocks, liquidity, sweeps, structure, killzone, pdArray, score };
}
