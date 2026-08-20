/**
 * SONIC BETA — DISPLAY-ONLY mapping for PRE_RAID_APPROACH_V1.
 *
 * This module maps the EXISTING deterministic 5-component score to labels for
 * the UI. It does NOT change the score formula, the features, the outcomes or
 * any gating: no import from Elliott, ICT, the setup engine or the decision
 * engine, and nothing here is consumed by them.
 *
 * The score is SETUP-LIKENESS (similitud con las entradas históricas de SONIC),
 * never a win probability.
 */
import { PRE_RAID_FEATURE_NAMES, type PreRaidFeatureName } from "./pre-raid";

export type SonicBetaState =
  | "SEÑAL BETA LONG"
  | "SEÑAL BETA SHORT"
  | "VIGILAR"
  | "SIN SEÑAL"
  | "CONFLICTO · SIN SEÑAL"
  | "FUERA DE VENTANA / ESPERANDO DATOS";

export interface SonicBetaSide {
  direction: "long" | "short";
  componentCount: number;
  /** "4/5 componentes" */
  componentsLabel: string;
  /** "80% similitud" — explicitly NOT a probability. */
  similarityLabel: string;
  state: Extract<SonicBetaState, "SEÑAL BETA LONG" | "SEÑAL BETA SHORT" | "VIGILAR" | "SIN SEÑAL">;
}

export interface SonicBetaDisplay {
  /** Headline state for the card. */
  headline: SonicBetaState;
  long: SonicBetaSide | null;
  short: SonicBetaSide | null;
  conflict: boolean;
  /** Non-negotiable disclaimer rendered with the card. */
  disclaimer: string;
}

export const SONIC_BETA_DISCLAIMER =
  "Señal experimental basada en similitud con las entradas históricas de SONIC. No representa probabilidad de ganancia y aún no participa en el gating principal.";

/** Plain-Spanish names for the 5 frozen components, in canonical order. */
export const SONIC_COMPONENT_LABELS_ES: Record<PreRaidFeatureName, string> = {
  dist_relevant_local_liq_atr: "Distancia a liquidez",
  approach_velocity_liq_3m_atr: "Velocidad de acercamiento",
  micro_hhhl_score_5: "Micro pullback",
  position_in_asia_range_dir: "Posición en rango Asia",
  minutes_since_relevant_raid_norm: "Estado de raid/liquidez",
};

export const SONIC_COMPONENT_ORDER: readonly PreRaidFeatureName[] = [
  "dist_relevant_local_liq_atr",
  "approach_velocity_liq_3m_atr",
  "micro_hhhl_score_5",
  "position_in_asia_range_dir",
  "minutes_since_relevant_raid_norm",
];

// Sanity: the display order must cover exactly the frozen feature set.
if (SONIC_COMPONENT_ORDER.length !== PRE_RAID_FEATURE_NAMES.length) {
  throw new Error("SONIC beta display order out of sync with PRE_RAID_FEATURE_NAMES");
}

function sideState(count: number, direction: "long" | "short"): SonicBetaSide["state"] {
  if (count >= 4) return direction === "long" ? "SEÑAL BETA LONG" : "SEÑAL BETA SHORT";
  if (count === 3) return "VIGILAR";
  return "SIN SEÑAL";
}

function makeSide(direction: "long" | "short", count: number | null): SonicBetaSide | null {
  if (count == null || !Number.isFinite(count)) return null;
  const c = Math.max(0, Math.min(5, Math.round(count)));
  return {
    direction,
    componentCount: c,
    componentsLabel: `${c}/5 componentes`,
    similarityLabel: `${c * 20}% similitud`,
    state: sideState(c, direction),
  };
}

/**
 * Map raw component counts (0..5) into the display contract.
 * `available: false` (outside the validated window or no fresh observation)
 * yields FUERA DE VENTANA / ESPERANDO DATOS — never a fabricated signal.
 */
export function mapSonicBeta(input: {
  available: boolean;
  longCount?: number | null;
  shortCount?: number | null;
}): SonicBetaDisplay {
  const base = { disclaimer: SONIC_BETA_DISCLAIMER };
  if (!input.available) {
    return {
      ...base,
      headline: "FUERA DE VENTANA / ESPERANDO DATOS",
      long: null,
      short: null,
      conflict: false,
    };
  }
  const long = makeSide("long", input.longCount ?? null);
  const short = makeSide("short", input.shortCount ?? null);
  if (!long && !short) {
    return {
      ...base,
      headline: "FUERA DE VENTANA / ESPERANDO DATOS",
      long: null,
      short: null,
      conflict: false,
    };
  }
  const longSignal = (long?.componentCount ?? 0) >= 4;
  const shortSignal = (short?.componentCount ?? 0) >= 4;
  if (longSignal && shortSignal) {
    return { ...base, headline: "CONFLICTO · SIN SEÑAL", long, short, conflict: true };
  }
  let headline: SonicBetaState = "SIN SEÑAL";
  if (longSignal) headline = "SEÑAL BETA LONG";
  else if (shortSignal) headline = "SEÑAL BETA SHORT";
  else if ((long?.componentCount ?? 0) === 3 || (short?.componentCount ?? 0) === 3)
    headline = "VIGILAR";
  return { ...base, headline, long, short, conflict: false };
}
