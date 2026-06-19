import type { PivotV2 } from "../schemas/analysis";
import type { LiquidityLevel } from "./types";

export function detectLiquidity(pivots: ReadonlyArray<PivotV2>, lastPrice: number, tol = 0.0015): LiquidityLevel[] {
  const highs = pivots.filter((p) => p.type === "HIGH");
  const lows = pivots.filter((p) => p.type === "LOW");
  const out: LiquidityLevel[] = [];
  const cluster = (xs: PivotV2[], kind: "BSL" | "SSL") => {
    const used = new Set<number>();
    for (let i = 0; i < xs.length; i++) {
      if (used.has(i)) continue;
      const ref = xs[i];
      let touches = 1;
      let last = ref;
      for (let j = i + 1; j < xs.length; j++) {
        if (Math.abs(xs[j].price - ref.price) / ref.price <= tol) {
          touches++;
          used.add(j);
          last = xs[j];
        }
      }
      if (touches >= 2) {
        const swept = kind === "BSL" ? lastPrice > ref.price : lastPrice < ref.price;
        out.push({ type: kind, price: ref.price, time: last.time, touches, swept });
      }
    }
  };
  cluster(highs, "BSL");
  cluster(lows, "SSL");
  return out;
}
