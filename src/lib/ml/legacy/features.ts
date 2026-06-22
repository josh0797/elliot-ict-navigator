// legacy-pretrained-html-v1 — feature extractor (frozen proxies)
// These are the literal formulas from train_model.py that produced the
// PRETRAINED weights embedded in elliott-ict-pro2.html. Do not "improve".

export const LEGACY_FEATURE_ORDER = [
  "fvgSizeProxy",
  "atrNormProxy",
  "isKillzone",
  "scoreProxy",
  "distObProxy",
  "waveCode",
] as const;

export type LegacyInput = {
  confirmationLevel: number;
  invalidationLevel: number;
  fibTarget1?: number | null;
  rrRatio?: number | null;
  hasAlternative?: boolean;
  currentPriceApprox?: number | null;
  waveLabel?: string | null;
};

export type LegacyFeatures = {
  raw: number[];
  normalized: number[];
  waveLabelUsed: string | null;
  warnings: string[];
};

const WAVE_CODE_MAP: Record<string, number> = {
  "1": 0.1, "(1)": 0.1, "i": 0.1, "(i)": 0.1,
  "2": 0.2, "(2)": 0.2, "ii": 0.2, "(ii)": 0.2,
  "3": 0.9, "(3)": 0.9, "iii": 0.9, "(iii)": 0.9,
  "4": 0.4, "(4)": 0.4, "iv": 0.4, "(iv)": 0.4,
  "5": 0.6, "(5)": 0.6, "v": 0.6, "(v)": 0.6,
  "a": 0.3,
  "b": 0.1,
  "c": 0.7,
};

export function waveCode(label: string | null | undefined): { value: number; known: boolean } {
  if (label == null) return { value: 0.5, known: false };
  const key = String(label).trim().toLowerCase();
  if (key === "") return { value: 0.5, known: false };
  if (Object.prototype.hasOwnProperty.call(WAVE_CODE_MAP, key)) {
    return { value: WAVE_CODE_MAP[key], known: true };
  }
  return { value: 0.5, known: false };
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Normalize a raw vector with min-max from PRETRAINED. No clipping. */
export function normalizeLegacy(raw: number[], minNorm: number[], maxNorm: number[]): number[] {
  const out = new Array<number>(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const mn = minNorm[i];
    const mx = maxNorm[i];
    if (mx > mn) out[i] = (raw[i] - mn) / (mx - mn);
    else out[i] = 0.5;
  }
  return out;
}

import { PRETRAINED } from "./pretrained";

export function extractLegacyFeatures(input: LegacyInput): LegacyFeatures {
  const warnings: string[] = [];
  const conf = input.confirmationLevel;
  const inv = input.invalidationLevel;
  const slSize = Math.abs(conf - inv);

  // tpSize: from fibTarget1 if finite; else 2R fallback
  const tpSize =
    isFiniteNumber(input.fibTarget1)
      ? Math.abs(conf - (input.fibTarget1 as number))
      : slSize * 2;

  // f0 — fvg size proxy (R-multiple proxy, NOT a real FVG measurement)
  const f0 = slSize > 0 ? Math.min(tpSize / slSize, 5) / 5 : 0;

  // f1 — atr norm proxy (sl/entry, NOT Wilder ATR)
  const f1 = conf !== 0 ? Math.min(slSize / Math.abs(conf), 0.05) / 0.05 : 0;

  // f2 — killzone constant (training contract: always 0.5)
  const f2 = 0.5;

  // f3 — score proxy (heuristic, NOT setup.score)
  const rr = isFiniteNumber(input.rrRatio) ? (input.rrRatio as number) : 0;
  const rrNorm = Math.min(Math.max(rr, 0), 5) / 5;
  const hasAlt = input.hasAlternative ? 1 : 0;
  const f3 = rrNorm * 0.7 + (1 - hasAlt) * 0.3;

  // f4 — dist OB proxy (price↔confirmation distance, NOT a real OB)
  let f4: number;
  if (isFiniteNumber(input.currentPriceApprox) && (input.currentPriceApprox as number) > 0 && slSize > 0) {
    const d = Math.abs((input.currentPriceApprox as number) - conf) / slSize;
    f4 = Math.min(d, 3) / 3;
  } else {
    f4 = 0.5;
  }

  // f5 — wave code (legacy ordinal mapping)
  const wc = waveCode(input.waveLabel ?? null);
  if (!wc.known && input.waveLabel != null && String(input.waveLabel).trim() !== "") {
    warnings.push("UNKNOWN_WAVE_LABEL");
  }
  const f5 = wc.value;

  const raw = [f0, f1, f2, f3, f4, f5];
  const normalized = normalizeLegacy(raw, PRETRAINED.minNorm as unknown as number[], PRETRAINED.maxNorm as unknown as number[]);

  return {
    raw,
    normalized,
    waveLabelUsed: input.waveLabel ?? null,
    warnings,
  };
}