/**
 * DISPLAY-ONLY plain-Spanish summary of an Elliott scenario.
 * Pure formatting over `ElliottResultDTO`; no algorithm is touched.
 */
import type { ElliottResultDTO } from "./types";

export interface PlainScenario {
  /** Vigente / Invalidado / Completado / Cerca de completarse. */
  state: string;
  stateTone: "ok" | "warn" | "bad" | "neutral";
  /** Alcista / Bajista / Neutral. */
  direction: string;
  directionTone: "up" | "down" | "flat";
  /** What the count expects next, in plain words. */
  expectation: string;
  /** Level that invalidates it (formatted) or null. */
  invalidation: string | null;
  /** Next objective (formatted) or null. */
  target: string | null;
  confidence: number;
}

function stateOf(status: string): { text: string; tone: PlainScenario["stateTone"] } {
  switch (status) {
    case "INVALIDATED":
      return { text: "Invalidado", tone: "bad" };
    case "STALE":
      return { text: "Desfasado", tone: "bad" };
    case "COMPLETED":
      return { text: "Completado", tone: "ok" };
    case "NEAR_COMPLETION":
      return { text: "Cerca de completarse", tone: "warn" };
    case "NO_COUNT":
      return { text: "Sin conteo", tone: "neutral" };
    default:
      return { text: "Vigente", tone: "ok" };
  }
}

function expectationOf(dto: ElliottResultDTO): string {
  const up = dto.bias === "BULLISH";
  const dirWord = up ? "subida" : dto.bias === "BEARISH" ? "bajada" : "movimiento";
  if (dto.status === "INVALIDATED")
    return "Este conteo ya no es válido: el precio rompió su nivel límite.";
  if (dto.status === "NO_COUNT") return "Aún no hay suficiente estructura para contar ondas.";
  if (dto.status === "COMPLETED")
    return `El ciclo se completó; se espera una corrección del último tramo de ${dirWord}.`;
  const wave = dto.currentWave ?? null;
  const next = dto.nextWave ?? null;
  if (wave == null) return `Se espera continuidad de la ${dirWord}.`;
  const head = `Va en la onda ${wave}`;
  if (next != null) return `${head} y espera continuar hacia la onda ${next} (${dirWord}).`;
  return `${head}; se espera que complete el tramo de ${dirWord}.`;
}

export function plainScenario(dto: ElliottResultDTO, pxFmt: (n: number) => string): PlainScenario {
  const st = stateOf(dto.status);
  return {
    state: st.text,
    stateTone: st.tone,
    direction: dto.bias === "BULLISH" ? "Alcista" : dto.bias === "BEARISH" ? "Bajista" : "Neutral",
    directionTone: dto.bias === "BULLISH" ? "up" : dto.bias === "BEARISH" ? "down" : "flat",
    expectation: expectationOf(dto),
    invalidation: dto.invalidationLevel != null ? pxFmt(dto.invalidationLevel) : null,
    target: dto.activeTarget
      ? pxFmt(dto.activeTarget.price)
      : dto.nextTarget
        ? pxFmt(dto.nextTarget.price)
        : null,
    confidence: dto.confidence,
  };
}
