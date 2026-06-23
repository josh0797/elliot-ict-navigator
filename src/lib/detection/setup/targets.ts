/**
 * Target ladder — TP1/TP2/TP3 selected from active opposite liquidity and
 * Fibonacci 1.618 / 2.618 extensions. Allocation percentages are
 * configurable.
 */
import type { LiquidityLevel } from "../ict/types";
import type { ElliottCountV2 } from "../elliott/types";
import type { SignalDirection, Tp2Source } from "./types";
import type { TargetAllocations } from "./config";

export interface TargetSpec {
  name: "TP1" | "TP2" | "TP3";
  price: number;
  reason: string;
  rr: number;
  riskReward: number;
  allocationPct: number;
  source:
    | { kind: "LIQUIDITY"; liquidityId: string }
    | { kind: "FIB"; wave: string; ratio: number; from: number; to: number; projectedFrom: number }
    | { kind: "FALLBACK"; r: number };
}

function priceAtLabel(count: ElliottCountV2, label: string): number | undefined {
  return count.labeled.find((l) => l.label === label)?.pivot.price;
}

function fibProjection(
  count: ElliottCountV2,
  direction: SignalDirection,
  ratio: number,
): Extract<TargetSpec["source"], { kind: "FIB" }> | null {
  const cw = count.currentWave;
  const sign = direction === "long" ? 1 : -1;
  // Correct base-leg / projection anchor pairs:
  //   W3 from W2 using |P1-P0|; W5 from W4 using |P3-P2|; WC from WB using |A-P5|.
  let from: number | undefined, to: number | undefined, projectedFrom: number | undefined, wave = "";
  if (cw === "2") {
    from = priceAtLabel(count, "0");
    to = priceAtLabel(count, "1");
    projectedFrom = priceAtLabel(count, "2");
    wave = "3";
  } else if (cw === "4") {
    from = priceAtLabel(count, "2");
    to = priceAtLabel(count, "3");
    projectedFrom = priceAtLabel(count, "4");
    wave = "5";
  } else if (cw === "B") {
    from = priceAtLabel(count, "5") ?? priceAtLabel(count, "0");
    to = priceAtLabel(count, "A");
    projectedFrom = priceAtLabel(count, "B");
    wave = "C";
  }
  if (from == null || to == null || projectedFrom == null) return null;
  if (![from, to, projectedFrom].every((v) => Number.isFinite(v))) return null;
  // returned descriptor — caller evaluates price with same sign convention.
  void sign;
  return { kind: "FIB", wave, ratio, from, to, projectedFrom };
}

function evalFib(s: Extract<TargetSpec["source"], { kind: "FIB" }>, direction: SignalDirection): number {
  const leg = Math.abs(s.to - s.from);
  return direction === "long" ? s.projectedFrom + s.ratio * leg : s.projectedFrom - s.ratio * leg;
}

export function pickTargets(args: {
  direction: SignalDirection;
  entry: number;
  risk: number;
  minRR: number;
  liquidity: ReadonlyArray<LiquidityLevel>;
  primary: ElliottCountV2 | null;
  allocations: TargetAllocations;
}): TargetSpec[] {
  const { direction, entry, risk, minRR, liquidity, primary, allocations } = args;
  const wantSide = direction === "long" ? "BSL" : "SSL";
  const isAhead = (price: number) => direction === "long" ? price > entry : price < entry;

  const eligible = liquidity
    .filter((l) => l.state === "ACTIVE" && !l.provisional && l.side === wantSide && isAhead(l.price))
    .filter((l) => Math.abs(l.price - entry) / risk >= minRR)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));

  const targets: TargetSpec[] = [];

  // TP1
  if (eligible[0]) {
    const liq = eligible[0];
    const rr = Math.abs(liq.price - entry) / risk;
    targets.push({
      name: "TP1", price: liq.price, reason: `Liquidez ${liq.kind} (${liq.side})`,
      rr, riskReward: rr, allocationPct: allocations.TP1,
      source: { kind: "LIQUIDITY", liquidityId: liq.id },
    });
  } else {
    const price = direction === "long" ? entry + 2 * risk : entry - 2 * risk;
    targets.push({
      name: "TP1", price, reason: "Fallback 2R", rr: 2, riskReward: 2, allocationPct: allocations.TP1,
      source: { kind: "FALLBACK", r: 2 },
    });
  }

  // TP2 — next liquidity beyond TP1, else 1.618 fib, else 3R
  const tp1Price = targets[0].price;
  const beyondTp1 = (p: number) => direction === "long" ? p > tp1Price : p < tp1Price;
  const nextLiq = eligible.find((l) => beyondTp1(l.price));
  if (nextLiq) {
    const rr = Math.abs(nextLiq.price - entry) / risk;
    targets.push({
      name: "TP2", price: nextLiq.price, reason: `Liquidez ${nextLiq.kind} (${nextLiq.side})`,
      rr, riskReward: rr, allocationPct: allocations.TP2,
      source: { kind: "LIQUIDITY", liquidityId: nextLiq.id },
    });
  } else if (primary) {
    const fib = fibProjection(primary, direction, 1.618);
    if (fib) {
      const price = evalFib(fib, direction);
      if (Number.isFinite(price) && beyondTp1(price)) {
        const rr = Math.abs(price - entry) / risk;
        targets.push({
          name: "TP2", price, reason: `Fib 1.618 W${fib.wave}`,
          rr, riskReward: rr, allocationPct: allocations.TP2,
          source: fib,
        });
      }
    }
  }
  if (targets.length < 2) {
    const price = direction === "long" ? entry + 3 * risk : entry - 3 * risk;
    targets.push({
      name: "TP2", price, reason: "Fallback 3R", rr: 3, riskReward: 3, allocationPct: allocations.TP2,
      source: { kind: "FALLBACK", r: 3 },
    });
  }

  // TP3 — 2.618 fib or 5R fallback
  const tp2Price = targets[1].price;
  const beyondTp2 = (p: number) => direction === "long" ? p > tp2Price : p < tp2Price;
  let tp3Added = false;
  if (primary) {
    const fib = fibProjection(primary, direction, 2.618);
    if (fib) {
      const price = evalFib(fib, direction);
      if (Number.isFinite(price) && beyondTp2(price)) {
        const rr = Math.abs(price - entry) / risk;
        targets.push({
          name: "TP3", price, reason: `Fib 2.618 W${fib.wave}`,
          rr, riskReward: rr, allocationPct: allocations.TP3,
          source: fib,
        });
        tp3Added = true;
      }
    }
  }
  if (!tp3Added) {
    const price = direction === "long" ? entry + 5 * risk : entry - 5 * risk;
    targets.push({
      name: "TP3", price, reason: "Fallback 5R", rr: 5, riskReward: 5, allocationPct: allocations.TP3,
      source: { kind: "FALLBACK", r: 5 },
    });
  }

  return targets;
}

/** Map first target to legacy `Tp2Source`-like descriptor for back-compat callers. */
export function legacyTp2Source(target: TargetSpec | undefined): Tp2Source {
  if (!target) return { kind: "FALLBACK", fallback: "3R" };
  if (target.source.kind === "FIB") {
    return {
      kind: "FIB_EXTENSION",
      wave: target.source.wave,
      from: target.source.from,
      to: target.source.to,
      projectedFrom: target.source.projectedFrom,
      ratio: 1.618,
    };
  }
  return { kind: "FALLBACK", fallback: "3R" };
}