import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/marketData/types";
import {
  inPreRaidWindow,
  PRE_RAID_DETECTOR_VERSION,
  PRE_RAID_FEATURE_NAMES,
  PRE_RAID_TRAIN_MEDIANS,
  PRE_RAID_TRAIN_SIGNS,
  scorePreRaidApproach,
  type PreRaidObservation,
} from "../pre-raid";
import { computePreRaidOutcome } from "../pre-raid-outcomes";

const MIN = 60;

/** 2026-08-20 was a Thursday; 07:00 London (BST) = 06:00 UTC. */
const CANDIDATE = Math.floor(Date.UTC(2026, 7, 20, 6, 0, 0) / 1000);
/** Start at 00:00 London = 23:00 UTC previous day. */
const SERIES_START = Math.floor(Date.UTC(2026, 7, 19, 23, 0, 0) / 1000);

function synth(from: number, to: number): Candle[] {
  const out: Candle[] = [];
  let i = 0;
  for (let t = from; t < to; t += MIN, i++) {
    const base = 3400 + Math.sin(i / 17) * 6 + i * 0.002;
    const open = base;
    const close = base + Math.cos(i / 7) * 0.8;
    out.push({
      time: t,
      open,
      high: Math.max(open, close) + 0.6,
      low: Math.min(open, close) - 0.6,
      close,
    });
  }
  return out;
}

const M1 = synth(SERIES_START, CANDIDATE);

function score(direction: "long" | "short", m1: Candle[] = M1, at = CANDIDATE) {
  return scorePreRaidApproach({ symbol: "XAU/USD", candidateAt: at, direction, m1 });
}

describe("PRE_RAID_APPROACH_V1 frozen constants", () => {
  const artifact = {
    dist_relevant_local_liq_atr: { median: 1.911168, sign: -1 },
    micro_hhhl_score_5: { median: 0.0, sign: -1 },
    minutes_since_relevant_raid_norm: { median: 1.0, sign: -1 },
    position_in_asia_range_dir: { median: 0.393471, sign: 1 },
    approach_velocity_liq_3m_atr: { median: 0.021757, sign: 1 },
  } as const;

  it("matches the Phase 3A-bis artifact values and order exactly", () => {
    expect([...PRE_RAID_FEATURE_NAMES]).toEqual(Object.keys(artifact));
    for (const name of PRE_RAID_FEATURE_NAMES) {
      expect(PRE_RAID_TRAIN_MEDIANS[name]).toBe(artifact[name].median);
      expect(PRE_RAID_TRAIN_SIGNS[name]).toBe(artifact[name].sign);
    }
  });

  it("exposes the documented detector version", () => {
    expect(PRE_RAID_DETECTOR_VERSION).toBe("PRE_RAID_APPROACH_V1");
  });
});

describe("PRE_RAID_APPROACH_V1 detector", () => {
  it("scores both directions independently for the same minute", () => {
    const long = score("long");
    const short = score("short");
    expect(long.ok).toBe(true);
    expect(short.ok).toBe(true);
    const l = long as PreRaidObservation;
    const s = short as PreRaidObservation;
    expect(l.referencePrice).toBe(s.referencePrice);
    expect(l.relevantLevel).not.toBe(s.relevantLevel);
    // Direction normalisation: HH/HL and Asia position mirror.
    expect(l.microPullback).toBeCloseTo(-s.microPullback, 12);
    expect(l.asiaPosition).toBeCloseTo(1 - s.asiaPosition, 12);
  });

  it("setup_score is component_count/5 on the 0,0.2,…,1 grid", () => {
    for (const dir of ["long", "short"] as const) {
      const r = score(dir) as PreRaidObservation;
      expect([0, 0.2, 0.4, 0.6, 0.8, 1]).toContain(r.setupScore);
      expect(r.setupScore).toBeCloseTo(r.componentCount / 5, 12);
      expect(r.componentCount).toBe(r.components.filter((c) => c.pass).length);
      for (const c of r.components) {
        expect(c.pass).toBe((c.value - c.trainMedian) * c.trainSign > 0);
      }
    }
  });

  it("is invariant to brutal future mutations (append / replace future bars)", () => {
    const before = JSON.stringify(score("long")) + JSON.stringify(score("short"));
    const future: Candle[] = [
      ...M1,
      // the candidate minute itself (partial) + violent future bars
      { time: CANDIDATE, open: 3400, high: 9999, low: 1, close: 9000 },
      { time: CANDIDATE + MIN, open: 9000, high: 12000, low: 2, close: 11000 },
      { time: CANDIDATE + 40 * MIN, open: 1, high: 2, low: 0.5, close: 1.5 },
    ];
    const after = JSON.stringify(score("long", future)) + JSON.stringify(score("short", future));
    expect(after).toBe(before);
  });

  it("never reads the candidate/partial minute", () => {
    const withCandidate = [...M1, { time: CANDIDATE, open: 1, high: 2, low: 0.5, close: 1.2 }];
    const r = score("long", withCandidate) as PreRaidObservation;
    expect(r.lastClosedM1At).toBe(CANDIDATE - MIN);
    expect(r.referencePrice).toBe(M1[M1.length - 1].close);
  });

  it("skips when the bar closing at the candidate minute is missing", () => {
    const gapped = M1.slice(0, -1);
    const r = score("long", gapped);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("M1_GAP_AT_CANDIDATE");
  });

  it("only accepts candidate minutes inside the validated London window", () => {
    expect(inPreRaidWindow(CANDIDATE)).toBe(true); // 07:00 London Thu
    expect(inPreRaidWindow(Math.floor(Date.UTC(2026, 7, 20, 4, 0, 0) / 1000))).toBe(false); // 05:00
    expect(inPreRaidWindow(Math.floor(Date.UTC(2026, 7, 20, 7, 30, 0) / 1000))).toBe(false); // 08:30
    expect(inPreRaidWindow(Math.floor(Date.UTC(2026, 7, 22, 6, 0, 0) / 1000))).toBe(false); // Saturday
  });

  it("uses no post-entry, outcome or provider input in the score", () => {
    const r = score("long") as PreRaidObservation;
    const featureKeys = Object.keys(r.features);
    expect(featureKeys).toEqual([...PRE_RAID_FEATURE_NAMES]);
    for (const k of featureKeys) expect(Number.isFinite(r.features[k as never])).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/provider|outcome|displacement/i);
  });
});

describe("PRE_RAID_APPROACH_V1 isolation", () => {
  const FORBIDDEN = ["elliott", "logreg", "detection/model", "detection/decision", "detection/setup", "detection/engine"];
  it("imports no Elliott / logreg / model / decision module", () => {
    const dir = join(process.cwd(), "src/lib/ml/smc");
    const files = readdirSync(dir).filter((f) => f.startsWith("pre-raid"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8").toLowerCase();
      const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      const dyn = [...src.matchAll(/import\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of [...specs, ...dyn]) {
        for (const bad of FORBIDDEN) expect(spec.includes(bad), `${f} imports ${spec}`).toBe(false);
      }
      expect(src).not.toContain("scoresetupml");
    }
  });
});

describe("PRE_RAID research outcomes", () => {
  const ref = 3400;
  const atr = 2;
  const bars: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    bars.push({
      time: CANDIDATE + i * MIN,
      open: ref,
      high: ref + 1 + i * 0.5,
      low: ref - 1 - i * 0.25,
      close: ref + i * 0.4,
    });
  }

  const run = (direction: "long" | "short", h: 1 | 3 | 5 | 15, m1 = bars) =>
    computePreRaidOutcome({
      candidateAt: CANDIDATE,
      direction,
      referencePrice: ref,
      atrM5: atr,
      horizonMinutes: h,
      m1,
    });

  it("computes long MFE/MAE/close return per horizon", () => {
    const o1 = run("long", 1)!;
    expect(o1.bars_used).toBe(1);
    expect(o1.mfe_atr).toBeCloseTo(1 / atr, 12);
    expect(o1.mae_atr).toBeCloseTo(1 / atr, 12);
    expect(o1.directional_close_return_atr).toBeCloseTo(0, 12);
    const o5 = run("long", 5)!;
    expect(o5.mfe_atr).toBeCloseTo((1 + 4 * 0.5) / atr, 12);
    expect(o5.directional_close_return_atr).toBeCloseTo((4 * 0.4) / atr, 12);
    expect(run("long", 15)!.displacement_1atr).toBe(true);
  });

  it("mirrors favorable/adverse for short", () => {
    const o3l = run("long", 3)!;
    const o3s = run("short", 3)!;
    expect(o3s.mfe_atr).toBeCloseTo(o3l.mae_atr, 12);
    expect(o3s.mae_atr).toBeCloseTo(o3l.mfe_atr, 12);
    expect(o3s.directional_close_return_atr).toBeCloseTo(-o3l.directional_close_return_atr, 12);
  });

  it("returns null when any required closed bar is missing", () => {
    const holed = bars.filter((b) => b.time !== CANDIDATE + 2 * MIN);
    expect(run("long", 1, holed)).not.toBeNull();
    expect(run("long", 3, holed)).toBeNull();
    expect(run("long", 15, bars.slice(0, 10))).toBeNull();
  });
});