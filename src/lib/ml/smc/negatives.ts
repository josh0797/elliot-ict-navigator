/**
 * Deterministic negative-candidate generation: "SONIC entry" vs "no SONIC entry".
 *
 * Selection uses ONLY pre-entry information (calendar, session, M30 phase and,
 * for hard negatives, pre-entry ATR/range supplied by the caller). Outcomes are
 * computed after selection and never influence it.
 */
import { londonClock } from "./clock";
import { floorToMinute, type SmcEntry, type SmcNegativeCandidate } from "./dataset";
import type { CandidateDirection } from "./types";

export interface NegativeSamplingOptions {
  /** Negatives per positive entry. */
  perPositive?: number;
  /** Sampling radius around the positive, in minutes. */
  windowMinutes?: number;
  /** Minimum separation from the positive minute (distinct decision point). */
  minDistanceMinutes?: number;
  /** Exclusion radius around every known positive entry. */
  exclusionMinutes?: number;
  /** Force the same 0-14 / 15-29 M30 phase bucket as the positive. */
  matchM30Phase?: boolean;
  /** Require the same London session bucket. */
  matchSession?: boolean;
  /** Restrict to these sessions (empirical operating period). */
  allowedSessions?: readonly string[];
  /** Deterministic seed. */
  seed?: string;
  /** Fraction of negatives that should be HARD_NEGATIVE (needs `preEntryStats`). */
  hardNegativeRatio?: number;
  /** Pre-entry stats used for hard-negative matching. Must never read the future. */
  preEntryStats?: (
    minute: number,
    direction: CandidateDirection,
  ) => { atr: number; range60: number } | null;
  /** Max relative deviation for a hard-negative match on ATR/range. */
  hardMatchTolerance?: number;
  /**
   * Reject candidates whose forward outcome window would overlap a known
   * positive entry. Uses only positive timestamps + `outcomeHorizonMinutes`.
   * Excluded interval per positive minute `pm`:
   *   |t - pm| < outcomeHorizonMinutes * 60
   * (i.e. neither [t, t+H) may contain pm, nor [pm, pm+H) contain t).
   */
  excludeOutcomeOverlap?: boolean;
  /** Forward outcome horizon used by the overlap guard (minutes). */
  outcomeHorizonMinutes?: number;
  /**
   * Allow deterministic same-week fallback days (Mon-Fri, same London-local
   * ISO week) when the positive's own date yields fewer than `perPositive`
   * eligible controls.
   */
  sameWeekFallback?: boolean;
}

const DEFAULTS: Required<
  Omit<NegativeSamplingOptions, "preEntryStats" | "allowedSessions">
> & { allowedSessions: readonly string[] } = {
  perPositive: 3,
  windowMinutes: 60,
  minDistanceMinutes: 16,
  exclusionMinutes: 15,
  matchM30Phase: true,
  matchSession: true,
  allowedSessions: ["LONDON_PRE", "LONDON", "NY_AM"],
  seed: "smc-negatives-v1",
  hardNegativeRatio: 0.34,
  hardMatchTolerance: 0.35,
  excludeOutcomeOverlap: true,
  outcomeHorizonMinutes: 30,
  sameWeekFallback: true,
};

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UTC-midnight timestamp of the Monday of the (London-local) week. */
function weekMonday(localDate: string): number {
  const t = Date.parse(`${localDate}T00:00:00Z`);
  const dow = new Date(t).getUTCDay();
  const back = (dow + 6) % 7;
  return t - back * 86400 * 1000;
}

/** Whole-day distance between two London-local dates. */
function dayDistance(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function m30Phase(minute: number): 0 | 1 {
  return londonClock(minute).inFirst15mAfterM30 ? 0 : 1;
}

/**
 * Generate matched no-entry controls for every positive entry.
 * Pure and deterministic for a given seed + positives set.
 */
export function generateNegativeCandidates(
  positives: readonly SmcEntry[],
  options: NegativeSamplingOptions = {},
): SmcNegativeCandidate[] {
  const opt = { ...DEFAULTS, ...options };
  const positiveMinutes = positives.map((p) => floorToMinute(p.entryTime)).sort((a, b) => a - b);
  const out: SmcNegativeCandidate[] = [];
  const used = new Set<number>();

  const sorted = [...positives].sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id));

  for (const pos of sorted) {
    const posMinute = floorToMinute(pos.entryTime);
    const posClock = londonClock(posMinute);
    const posPhase = m30Phase(posMinute);
    const posStats = opt.preEntryStats?.(posMinute, pos.direction) ?? null;

    const isExcluded = (t: number): boolean => {
      for (const pm of positiveMinutes) {
        const gap = Math.abs(pm - t);
        if (gap <= opt.exclusionMinutes * 60) return true;
        if (opt.excludeOutcomeOverlap && gap < opt.outcomeHorizonMinutes * 60) return true;
      }
      return false;
    };

    const eligible = (t: number, sameDate: boolean): boolean => {
      if (used.has(t)) return false;
      const clk = londonClock(t);
      if (clk.dayOfWeek === 0 || clk.dayOfWeek === 6) return false;
      if (!opt.allowedSessions.includes(clk.session)) return false;
      if (opt.matchSession && clk.session !== posClock.session) return false;
      if (opt.matchM30Phase && m30Phase(t) !== posPhase) return false;
      if (sameDate && Math.abs(t - posMinute) < opt.minDistanceMinutes * 60) return false;
      if (isExcluded(t)) return false;
      return true;
    };

    /** Minutes around the positive's local time-of-day, shifted by whole days. */
    const dayCandidates = (dayOffset: number): number[] => {
      const out: number[] = [];
      const base = posMinute + dayOffset * 86400;
      for (let d = -opt.windowMinutes; d <= opt.windowMinutes; d++) {
        const t = base + d * 60;
        if (!eligible(t, dayOffset === 0)) continue;
        out.push(t);
      }
      return out;
    };

    const posWeek = weekMonday(posClock.localDate);
    const shuffleWith = (list: number[], salt: string): number[] => {
      const rng = mulberry32(hashSeed(`${opt.seed}:${pos.id}:${salt}`));
      const pool = [...list].sort((a, b) => a - b);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool;
    };

    // Same date first, then nearest same-week trading day, then seeded order.
    const candidates: number[] = shuffleWith(dayCandidates(0), "d0");
    if (opt.sameWeekFallback && candidates.length < opt.perPositive) {
      const offsets: number[] = [];
      for (let k = 1; k <= 4; k++) offsets.push(-k, k);
      for (const off of offsets) {
        if (candidates.length >= opt.perPositive) break;
        const probe = posMinute + off * 86400;
        const clk = londonClock(probe);
        if (clk.dayOfWeek === 0 || clk.dayOfWeek === 6) continue;
        if (weekMonday(clk.localDate) !== posWeek) continue;
        candidates.push(...shuffleWith(dayCandidates(off), `d${off}`));
      }
    }

    if (!candidates.length) continue;

    // Priority order is already: same date, then nearest same-week day.
    const pool = candidates;

    const wantHard = posStats
      ? Math.min(opt.perPositive, Math.round(opt.perPositive * opt.hardNegativeRatio))
      : 0;

    const hardPool = posStats
      ? pool
          .map((t) => {
            const st = opt.preEntryStats?.(t, pos.direction) ?? null;
            if (!st || !(posStats.atr > 0) || !(posStats.range60 > 0) || !st.atr) return null;
            const atrRatio = st.atr / posStats.atr;
            const rangeRatio = st.range60 / posStats.range60;
            const ok =
              Math.abs(atrRatio - 1) <= opt.hardMatchTolerance &&
              Math.abs(rangeRatio - 1) <= opt.hardMatchTolerance;
            return ok ? { t, atrRatio, rangeRatio } : null;
          })
          .filter((x): x is { t: number; atrRatio: number; rangeRatio: number } => x !== null)
      : [];

    const chosen: Array<{
      t: number;
      kind: "MATCHED_TIME" | "HARD_NEGATIVE";
      atrRatio: number | null;
      rangeRatio: number | null;
    }> = [];

    for (const h of hardPool) {
      if (chosen.length >= wantHard) break;
      if (used.has(h.t)) continue;
      used.add(h.t);
      chosen.push({ t: h.t, kind: "HARD_NEGATIVE", atrRatio: h.atrRatio, rangeRatio: h.rangeRatio });
    }
    for (const t of pool) {
      if (chosen.length >= opt.perPositive) break;
      if (used.has(t)) continue;
      used.add(t);
      const st = opt.preEntryStats?.(t, pos.direction) ?? null;
      chosen.push({
        t,
        kind: "MATCHED_TIME",
        atrRatio: st && posStats && posStats.atr > 0 ? st.atr / posStats.atr : null,
        rangeRatio: st && posStats && posStats.range60 > 0 ? st.range60 / posStats.range60 : null,
      });
    }

    for (const c of chosen) {
      const clk = londonClock(c.t);
      out.push({
        id: `${pos.id}::neg::${c.t}`,
        symbol: pos.symbol,
        entryTime: c.t,
        // Matched-control analysis: copy the paired entry's direction.
        direction: pos.direction,
        kind: c.kind,
        meta: {
          negative_kind: c.kind,
          paired_positive_id: pos.id,
          distance_minutes: Math.round((c.t - posMinute) / 60),
          same_date: clk.localDate === posClock.localDate,
          day_distance: dayDistance(posClock.localDate, clk.localDate),
          same_session: clk.session === posClock.session,
          same_m30_phase: m30Phase(c.t) === posPhase,
          seed: `${opt.seed}:${pos.id}`,
          atr_ratio: c.atrRatio,
          range_ratio: c.rangeRatio,
        },
      });
    }
  }

  return out.sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id));
}

/** Convert generated negatives into dataset entries. */
export function negativesToEntries(negatives: readonly SmcNegativeCandidate[]): SmcEntry[] {
  return negatives.map((n) => ({
    id: n.id,
    symbol: n.symbol,
    entryTime: n.entryTime,
    direction: n.direction,
    kind: n.kind,
    negative: n.meta,
  }));
}
