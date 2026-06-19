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
  const orderBlocks = detectOrderBlocks(candles);
  const lastPrice = candles.length ? candles[candles.length - 1].close : 0;
  const liquidity = detectLiquidity(pivots, lastPrice);
  const sweeps = detectSweeps(candles, pivots);
  const structure = detectStructure(pivots);
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
  if (sweeps.length > 0 && sweeps[sweeps.length - 1].index >= candles.length - 5) score += 0.15;
  if (fvgs.some((f) => !f.mitigated)) score += 0.1;
  if (orderBlocks.some((ob) => !ob.mitigated)) score += 0.15;
  score = Math.min(1, score);

  return { bias, fvgs, orderBlocks, liquidity, sweeps, structure, killzone, pdArray, score };
}
