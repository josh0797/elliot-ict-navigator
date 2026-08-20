/**
 * DISPLAY-ONLY plain-Spanish translation of the operational decision.
 *
 * Pure functions over an existing `OperationalReport`. They never change
 * decision semantics, gating, scoring or any algorithm: they only rephrase
 * codes (WATCHING, NO_VALID_TEMPLATE, DIRECTION_CONFLICT, …) into sentences a
 * trader can read at a glance. Raw technical fields stay available for the
 * Diagnostic view / collapsible details.
 */
import type {
  DecisionReasonCode,
  OperationalDecision,
  OperationalReport,
  OperationalSetupStatus,
  SetupTemplate,
  VoteDirection,
} from "./types";

export const ACTION_ES: Record<OperationalDecision, string> = {
  BUY: "COMPRAR",
  SELL: "VENDER",
  WAIT: "ESPERAR",
  NO_TRADE: "NO OPERAR",
};

export const DIRECTION_ES: Record<VoteDirection, string> = {
  BULLISH: "alcista",
  BEARISH: "bajista",
  NEUTRAL: "neutral",
};

const STATUS_ES: Record<OperationalSetupStatus, string> = {
  NO_SETUP: "Sin entrada válida todavía",
  WATCHING: "Vigilando el mercado",
  WAITING_FOR_SWEEP: "Esperando barrido de liquidez",
  WAITING_FOR_STRUCTURE_SHIFT: "Esperando cambio de estructura",
  WAITING_FOR_RETRACE: "Esperando retroceso al precio de entrada",
  ARMED: "Entrada preparada",
  TRIGGERED: "Entrada activada",
  ACTIVE: "Operación en curso",
  PARTIAL_TP: "Objetivo parcial tomado",
  TP1_HIT: "Objetivo 1 alcanzado",
  TP2_HIT: "Objetivo 2 alcanzado",
  STOPPED: "Operación detenida en el stop",
  EXPIRED: "Escenario caducado",
  INVALIDATED: "Escenario invalidado",
};

const TEMPLATE_ES: Record<SetupTemplate, string> = {
  ICT_BULLISH_REVERSAL: "Giro al alza tras barrido de liquidez",
  ICT_BEARISH_REVERSAL: "Giro a la baja tras barrido de liquidez",
  BULLISH_CONTINUATION: "Continuación al alza",
  BEARISH_CONTINUATION: "Continuación a la baja",
  ELLIOTT_WAVE_3_ENTRY: "Entrada en tercera onda (tramo más fuerte)",
  ELLIOTT_WAVE_5_ENTRY: "Entrada en quinta onda (último tramo)",
  ABC_COMPLETION_REVERSAL: "Giro tras completarse la corrección ABC",
  ENDING_DIAGONAL_REVERSAL: "Giro tras cuña final",
  NO_VALID_TEMPLATE: "Aún no hay una entrada válida",
};

const REASON_ES: Record<DecisionReasonCode, string> = {
  NO_PRIMARY_COUNT: "Todavía no hay un conteo de ondas fiable.",
  ELLIOTT_INVALIDATED: "El conteo principal quedó invalidado por el precio.",
  MANDATORY_RULE_FAIL: "El conteo no cumple una regla obligatoria de Elliott.",
  DIRECTION_CONFLICT: "Elliott e ICT todavía no apuntan en la misma dirección.",
  NO_VALID_POI: "No hay una zona de interés válida donde entrar.",
  WAITING_RETRACE: "Falta que el precio vuelva a la zona de entrada.",
  MARKET_TRIGGERED: "La entrada ya se activó a mercado.",
  WAITING_FOR_STRUCTURE_SHIFT: "Falta que la estructura gire para confirmar.",
  WAITING_FOR_SWEEP: "Falta un barrido de liquidez que active el escenario.",
  INSUFFICIENT_RR: "La relación riesgo/beneficio no es suficiente.",
  NO_DOMINANT_BIAS: "No hay una dirección dominante clara.",
  ELLIOTT_ICT_CONFLICT: "Elliott e ICT todavía no apuntan en la misma dirección.",
  SCENARIO_STALE: "El escenario quedó desfasado respecto al precio actual.",
  DATA_STALE: "Los datos de mercado están retrasados: análisis en pausa.",
  OK: "Condiciones cumplidas.",
};

export function reasonEs(code: DecisionReasonCode): string {
  return REASON_ES[code] ?? code.replace(/_/g, " ").toLowerCase();
}

export function statusEs(status: OperationalSetupStatus): string {
  return STATUS_ES[status] ?? status.replace(/_/g, " ").toLowerCase();
}

export function templateEs(template: SetupTemplate): string {
  return TEMPLATE_ES[template] ?? template.replace(/_/g, " ").toLowerCase();
}

export interface PlainExplanation {
  /** COMPRAR / VENDER / ESPERAR / NO OPERAR. */
  action: string;
  /** One natural sentence answering "why". */
  why: string;
  /** What confirms the entry (empty when nothing is pending). */
  confirms: string[];
  /** What is still missing (empty when nothing is pending). */
  missing: string[];
  /** Invalidation sentence, when a level exists. */
  invalidation: string | null;
  /** Elliott + ICT context in plain words. */
  context: string;
  /** Plain status line. */
  status: string;
}

/**
 * Build the plain-Spanish explanation for a report. `pxFmt` formats prices with
 * the symbol's precision.
 */
export function explainPlain(
  report: OperationalReport,
  pxFmt: (n: number) => string,
): PlainExplanation {
  const sig = report.primarySignal;
  const dir = DIRECTION_ES[report.direction];
  const action = ACTION_ES[report.decision];

  const why = buildWhy(report, dir);

  const confirms: string[] = [];
  if (sig) {
    if (sig.trigger) {
      confirms.push(
        sig.trigger.satisfied
          ? `Ya se cumplió: ${sig.trigger.description}`
          : sig.trigger.description,
      );
    }
    if (report.decision === "BUY" || report.decision === "SELL") {
      const atMarket = sig.orderType === "MARKET_BUY" || sig.orderType === "MARKET_SELL";
      confirms.push(
        `Entrada ${atMarket ? "a mercado" : "en la zona"} ${pxFmt(sig.entryZone.bottom)}–${pxFmt(sig.entryZone.top)} con stop en ${pxFmt(sig.sl)}`,
      );
    }

  }

  const missing = report.decision === "BUY" || report.decision === "SELL" ? [] : plainMissing(report);

  const invPrice = sig?.invalidation?.price ?? null;
  const invalidation =
    invPrice != null
      ? `El escenario se cancela si el precio cierra cruzando ${pxFmt(invPrice)}${sig?.invalidation?.reason ? ` (${sig.invalidation.reason})` : ""}.`
      : null;

  const split = report.biasSplit;
  const context = split
    ? `Elliott ${DIRECTION_ES[split.elliottBias as VoteDirection] ?? "neutral"} · ICT ${DIRECTION_ES[split.ictBias as VoteDirection] ?? "neutral"}${
        split.finalBias === "MIXED" ? " · señales mezcladas" : ""
      }`
    : `Dirección general ${dir}`;

  return {
    action,
    why,
    confirms,
    missing,
    invalidation,
    context,
    status: statusEs(report.status),
  };
}

function buildWhy(report: OperationalReport, dir: string): string {
  const sig = report.primarySignal;
  if (report.decision === "BUY" || report.decision === "SELL") {
    const verb = report.decision === "BUY" ? "compra" : "venta";
    const tpl = templateEs(report.template);
    return `Hay una ${verb} válida: ${tpl.toLowerCase()}${sig ? `, con calidad ${sig.scoreOut100}/100` : ""}.`;
  }
  if (report.decision === "WAIT") {
    const first = report.reasons.find((r) => r !== "OK");
    const head =
      report.direction === "NEUTRAL"
        ? "Todavía no hay una dirección clara."
        : `El contexto es ${dir}, pero falta confirmación.`;
    return first ? `${head} ${reasonEs(first)}` : head;
  }
  const first = report.reasons.find((r) => r !== "OK");
  return first ? reasonEs(first) : "Aún no hay una entrada válida.";
}

/** Missing conditions, already de-jargonised. */
export function plainMissing(report: OperationalReport): string[] {
  const out: string[] = [];
  for (const m of report.missing) out.push(humanizeToken(m));
  for (const r of report.reasons) {
    if (r === "OK" || r === "MARKET_TRIGGERED") continue;
    const text = reasonEs(r);
    if (!out.includes(text)) out.push(text);
  }
  return out.slice(0, 4);
}

/** Turn engine tokens such as `WAITING_FOR_SWEEP` into readable Spanish. */
export function humanizeToken(token: string): string {
  const upper = token.toUpperCase().replace(/\s+/g, "_");
  if (upper in REASON_ES) return REASON_ES[upper as DecisionReasonCode];
  if (upper in STATUS_ES) return STATUS_ES[upper as OperationalSetupStatus];
  if (upper in TEMPLATE_ES) return TEMPLATE_ES[upper as SetupTemplate];
  if (!/^[A-Z0-9_]+$/.test(token)) return token;
  const words = token.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
