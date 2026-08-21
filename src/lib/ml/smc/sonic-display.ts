/**
 * SONIC display semantics (v2.2 alignment with the TradingView indicator).
 *
 * DISPLAY-ONLY. Nothing here changes PRE_RAID_APPROACH_V1: the frozen medians,
 * signs, feature set, `setup_score = component_count / 5` contract and the
 * isolation guarantee (no gating, no alerts, no execution) stay untouched.
 *
 * Semantics enforced by this module:
 *  - LONG / SHORT are directional CANDIDATES of the detector, not BUY/SELL.
 *  - Δ between sides is likeness CONTRAST, never expected price direction.
 *  - counts/frequencies are frequencies, never win probabilities.
 */
import {
  PRE_RAID_FEATURE_NAMES,
  PRE_RAID_TRAIN_MEDIANS,
  PRE_RAID_TRAIN_SIGNS,
  type PreRaidFeatureName,
} from "./pre-raid";

export type SonicComponentCode = "D" | "M" | "R" | "A" | "V";

/** D/M/R/A/V ↔ frozen feature names. */
export const SONIC_COMPONENT_CODES: Readonly<Record<PreRaidFeatureName, SonicComponentCode>> = {
  dist_relevant_local_liq_atr: "D",
  micro_hhhl_score_5: "M",
  minutes_since_relevant_raid_norm: "R",
  position_in_asia_range_dir: "A",
  approach_velocity_liq_3m_atr: "V",
};

/** Canonical D → M → R → A → V order. */
export const SONIC_CODE_ORDER: readonly PreRaidFeatureName[] = [
  "dist_relevant_local_liq_atr",
  "micro_hhhl_score_5",
  "minutes_since_relevant_raid_norm",
  "position_in_asia_range_dir",
  "approach_velocity_liq_3m_atr",
];

if (SONIC_CODE_ORDER.length !== PRE_RAID_FEATURE_NAMES.length) {
  throw new Error("SONIC_CODE_ORDER out of sync with PRE_RAID_FEATURE_NAMES");
}

export const SONIC_DELTA_NOTE =
  "Δ SONIC = contraste de likeness, no dirección esperada del precio";
export const SONIC_FREQUENCY_NOTE = "frequency ≠ probability";
export const SONIC_DATA_MODE_NOTE = "TradingView feed may differ from server provider";
export const SONIC_SERVER_DATA_MODE = "Server M1 closed data";
export const ELLIOTT_FIT_HELP =
  "Elliott fit mide ajuste estructural y Fibonacci; no es probabilidad de que el precio suba/baje";

export interface SonicComponentView {
  name: PreRaidFeatureName;
  code: SonicComponentCode;
  value: number | null;
  trainMedian: number;
  trainSign: 1 | -1;
  pass: boolean;
}

/** Same rule as the detector: `(value - trainMedian) * trainSign > 0`. */
export function componentPass(name: PreRaidFeatureName, value: number | null): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return (value - PRE_RAID_TRAIN_MEDIANS[name]) * PRE_RAID_TRAIN_SIGNS[name] > 0;
}

type StoredComponent = { name?: unknown; value?: unknown; pass?: unknown };

/**
 * Build the D/M/R/A/V view from the stored `components` JSON when available,
 * falling back to the frozen pass rule over raw feature values.
 */
export function componentViews(
  components: unknown,
  features?: Record<string, unknown> | null,
): SonicComponentView[] {
  const stored = new Map<string, StoredComponent>();
  if (Array.isArray(components)) {
    for (const c of components as StoredComponent[]) {
      if (c && typeof c.name === "string") stored.set(c.name, c);
    }
  }
  return SONIC_CODE_ORDER.map((name) => {
    const s = stored.get(name);
    const rawValue =
      typeof s?.value === "number"
        ? s.value
        : typeof features?.[name] === "number"
          ? (features[name] as number)
          : null;
    const value = rawValue != null && Number.isFinite(rawValue) ? rawValue : null;
    const pass = typeof s?.pass === "boolean" ? s.pass : componentPass(name, value);
    return {
      name,
      code: SONIC_COMPONENT_CODES[name],
      value,
      trainMedian: PRE_RAID_TRAIN_MEDIANS[name],
      trainSign: PRE_RAID_TRAIN_SIGNS[name],
      pass,
    };
  });
}

/** "D1 M0 R1 A1 V1" */
export function compactComponents(views: readonly SonicComponentView[]): string {
  return views.map((v) => `${v.code}${v.pass ? 1 : 0}`).join(" ");
}

export type PairBalanceCode =
  | "BALANCED"
  | "LOW_CONTRAST_L"
  | "LOW_CONTRAST_S"
  | "HIGH_CONTRAST_L"
  | "HIGH_CONTRAST_S";

export interface PairBalance {
  /** longCount - shortCount. */
  delta: number;
  code: PairBalanceCode;
  label: string;
}

/**
 * Pair balance for a paired candidate minute (same `candidate_at`).
 * Returns null when the minute is not paired.
 */
export function pairBalance(
  longCount: number | null | undefined,
  shortCount: number | null | undefined,
): PairBalance | null {
  if (longCount == null || shortCount == null) return null;
  if (!Number.isFinite(longCount) || !Number.isFinite(shortCount)) return null;
  const delta = Math.round(longCount) - Math.round(shortCount);
  const sign = delta >= 0 ? "+" : "";
  const d = `Δ${sign}${delta}`;
  if (delta === 0) return { delta, code: "BALANCED", label: `BALANCED ${d}` };
  if (delta >= 3) return { delta, code: "HIGH_CONTRAST_L", label: `HIGH CONTRAST L>S ${d}` };
  if (delta <= -3) return { delta, code: "HIGH_CONTRAST_S", label: `HIGH CONTRAST S>L ${d}` };
  if (delta > 0) return { delta, code: "LOW_CONTRAST_L", label: `LOW CONTRAST L>S ${d}` };
  return { delta, code: "LOW_CONTRAST_S", label: `LOW CONTRAST S>L ${d}` };
}

/** Minimum sample before a historical state frequency is shown at all. */
export const SONIC_MIN_FREQUENCY_SAMPLE = 20;

export interface StateFrequencyView {
  text: string;
  sufficient: boolean;
}

/** "L 4/5 seen in 14.2% of LONG observations" — frequency, never probability. */
export function stateFrequencyLabel(input: {
  direction: "long" | "short";
  componentCount: number;
  matches: number;
  total: number;
}): StateFrequencyView {
  const tag = input.direction === "long" ? "L" : "S";
  const dir = input.direction.toUpperCase();
  if (input.total < SONIC_MIN_FREQUENCY_SAMPLE) {
    return { text: `${tag} ${input.componentCount}/5 · insufficient sample`, sufficient: false };
  }
  const rate = ((input.matches / input.total) * 100).toFixed(1);
  return {
    text: `${tag} ${input.componentCount}/5 seen in ${rate}% of ${dir} observations`,
    sufficient: true,
  };
}
