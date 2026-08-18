/**
 * Presentation layer for Elliott labels.
 *
 * The engine and every rule depend on the canonical labels "0".."5" and
 * "A".."C" / "W".."Z". They are NEVER rewritten. This module only converts
 * them for rendering, per Elliott degree.
 */
import type { ElliottDegree } from "./degrees";

/** Degrees plus the pseudo-degree used for internal subdivisions. */
export type DisplayDegree = ElliottDegree | "INTERNAL";

export const DEGREE_COLORS: Record<DisplayDegree, string> = {
  MAJOR: "#A78BFA",
  INTERMEDIATE: "#FBBF24",
  MINOR: "#22D3EE",
  INTERNAL: "#22D3EE",
};

export function degreeColor(degree: DisplayDegree | undefined | null): string {
  return DEGREE_COLORS[(degree ?? "INTERMEDIATE") as DisplayDegree] ?? DEGREE_COLORS.INTERMEDIATE;
}

const ROMAN: Record<string, string> = { "1": "i", "2": "ii", "3": "iii", "4": "iv", "5": "v" };

/**
 * Visual label for a canonical wave label.
 *  MAJOR        → [1] … [5], [A] … [C]
 *  INTERMEDIATE → 1 … 5, A … C
 *  MINOR/INTERNAL → i … v, a … c
 */
export function displayWaveLabel(label: string, degree: DisplayDegree | undefined | null): string {
  const deg: DisplayDegree = (degree ?? "INTERMEDIATE") as DisplayDegree;
  if (deg === "MINOR" || deg === "INTERNAL") {
    return ROMAN[label] ?? label.toLowerCase();
  }
  if (deg === "MAJOR") return `[${label.toUpperCase()}]`;
  return label.toUpperCase();
}
