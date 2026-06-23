/**
 * Operational Decision Engine — single entry point converting canonical
 * Elliott × ICT analyses + pre-gated TradeSignals into one actionable
 * `OperationalReport` (BUY / SELL / WAIT / NO_TRADE).
 *
 * Hard gates already applied upstream in `setup/engine.ts` (Elliott primary
 * validity, finite levels, RR ≥ minRR, POI active, structural confirmation,
 * etc.) — this layer adds direction-bias arbitration, mandatory-rule
 * checks and template/status classification.
 */
import type { ElliottAnalysis } from "../elliott/types";
import type { IctContext } from "../ict/types";
import type { TradeSignal } from "../setup/types";
import { computeDirectionBias } from "./direction";
import { classifyTemplate } from "./template";
import type {
  DecisionReasonCode,
  OperationalDecision,
  OperationalReport,
  OperationalSetupStatus,
  VoteDirection,
} from "./types";

export interface DecisionEngineOptions {
  minRR?: number;
}

const MANDATORY_RULES = ["W2_ORIGIN", "W3_NOT_SHORTEST", "W4_OVERLAP"] as const;

function pickSignalForDirection(
  signals: ReadonlyArray<TradeSignal>,
  dir: "long" | "short",
): TradeSignal | null {
  const matching = signals
    .filter((s) => s.direction === dir)
    .filter((s) => s.status !== "INVALIDATED" && s.status !== "NO_SETUP")
    .sort((a, b) => b.score - a.score);
  return matching[0] ?? null;
}

function statusFromSignal(signal: TradeSignal): OperationalSetupStatus {
  switch (signal.status) {
    case "TRIGGERED": return "TRIGGERED";
    case "WAITING_RETRACE": return "ARMED";
    case "READY": return "ARMED";
    case "INVALIDATED": return "INVALIDATED";
    case "NO_SETUP": return "NO_SETUP";
    default: return "WATCHING";
  }
}

function decisionFromSignal(signal: TradeSignal): OperationalDecision {
  // Once a signal has cleared engine gates and has a defined entry+SL+TP,
  // it is actionable — whether the entry is a pending order (ARMED) or
  // already at-price (TRIGGERED).
  return signal.direction === "long" ? "BUY" : "SELL";
}

function dirToVote(d: "long" | "short"): VoteDirection {
  return d === "long" ? "BULLISH" : "BEARISH";
}

function describe(report: Omit<OperationalReport, "summary">): string {
  const dirLabel = report.direction === "BULLISH" ? "alcista" : report.direction === "BEARISH" ? "bajista" : "neutral";
  switch (report.decision) {
    case "BUY": return `BUY — setup ${report.template.toLowerCase().replace(/_/g, " ")} listo (${report.status}).`;
    case "SELL": return `SELL — setup ${report.template.toLowerCase().replace(/_/g, " ")} listo (${report.status}).`;
    case "WAIT": return `WAIT — sesgo ${dirLabel}; falta ${report.missing.join(", ") || "confirmación"}.`;
    case "NO_TRADE": return `NO TRADE — ${report.reasons.join(", ")}.`;
  }
}

export function decideOperation(
  elliott: ElliottAnalysis,
  ict: IctContext,
  signals: ReadonlyArray<TradeSignal>,
  candleCount: number,
  _opts: DecisionEngineOptions = {},
): OperationalReport {
  const reasons: DecisionReasonCode[] = [];
  const missing: string[] = [];

  // ── Gate A: no count at all → NO_TRADE.
  if (!elliott.primary && elliott.alternatives.length === 0) {
    const empty: OperationalReport = {
      decision: "NO_TRADE",
      status: "NO_SETUP",
      template: "NO_VALID_TEMPLATE",
      direction: "NEUTRAL",
      bias: { dominant: "NEUTRAL", bullScore: 0, bearScore: 0, conflict: false, votes: [] },
      primarySignal: null,
      reasons: ["NO_PRIMARY_COUNT"],
      summary: "",
      missing: [],
    };
    return { ...empty, summary: describe(empty) };
  }

  // ── Gate B: Elliott primary invalidated AND no alternative.
  if (elliott.primary?.state === "INVALIDATED" && elliott.alternatives.length === 0) {
    const r: OperationalReport = {
      decision: "NO_TRADE",
      status: "INVALIDATED",
      template: "NO_VALID_TEMPLATE",
      direction: "NEUTRAL",
      bias: { dominant: "NEUTRAL", bullScore: 0, bearScore: 0, conflict: false, votes: [] },
      primarySignal: null,
      reasons: ["ELLIOTT_INVALIDATED"],
      summary: "",
      missing: [],
    };
    return { ...r, summary: describe(r) };
  }

  // ── Gate C: mandatory Elliott rule FAILed → NO_TRADE unless an alternative is valid.
  const primaryRules = (elliott.primary?.invalidations ?? []) as readonly string[];
  const mandatoryFailed = MANDATORY_RULES.some((code) =>
    primaryRules.some((v) => v.includes(code)),
  );
  if (mandatoryFailed && elliott.alternatives.length === 0) {
    const r: OperationalReport = {
      decision: "NO_TRADE",
      status: "INVALIDATED",
      template: "NO_VALID_TEMPLATE",
      direction: "NEUTRAL",
      bias: { dominant: "NEUTRAL", bullScore: 0, bearScore: 0, conflict: false, votes: [] },
      primarySignal: null,
      reasons: ["MANDATORY_RULE_FAIL"],
      summary: "",
      missing: [],
    };
    return { ...r, summary: describe(r) };
  }

  // ── Direction arbitration
  const bias = computeDirectionBias(elliott, ict, candleCount);

  if (bias.conflict) {
    const r: OperationalReport = {
      decision: "WAIT",
      status: "WATCHING",
      template: "NO_VALID_TEMPLATE",
      direction: "NEUTRAL",
      bias,
      primarySignal: null,
      reasons: ["DIRECTION_CONFLICT"],
      summary: "",
      missing: ["resolución del conflicto direccional"],
    };
    return { ...r, summary: describe(r) };
  }

  if (bias.dominant === "NEUTRAL") {
    const r: OperationalReport = {
      decision: "NO_TRADE",
      status: "NO_SETUP",
      template: "NO_VALID_TEMPLATE",
      direction: "NEUTRAL",
      bias,
      primarySignal: null,
      reasons: ["NO_DOMINANT_BIAS"],
      summary: "",
      missing: [],
    };
    return { ...r, summary: describe(r) };
  }

  // ── Match a signal to the dominant direction
  const dirSide = bias.dominant === "BULLISH" ? "long" : "short";
  const signal = pickSignalForDirection(signals, dirSide);

  if (!signal) {
    // We have bias but no setup that cleared all hard gates yet.
    const cutoff = candleCount - 15;
    const hasRecentSweep = ict.sweeps.some((s) => s.index >= cutoff);
    const hasConfirmedStruct = ict.structure.some(
      (e) => e.state === "CONFIRMED" && e.direction === dirSide && e.index >= cutoff,
    );
    let status: OperationalSetupStatus = "WATCHING";
    if (!hasRecentSweep) {
      status = "WAITING_FOR_SWEEP";
      missing.push("barrido de liquidez");
      reasons.push("WAITING_FOR_SWEEP");
    } else if (!hasConfirmedStruct) {
      status = "WAITING_FOR_STRUCTURE_SHIFT";
      missing.push("BOS/CHoCH confirmado");
      reasons.push("WAITING_FOR_STRUCTURE_SHIFT");
    } else {
      missing.push("POI activo con RR suficiente");
      reasons.push("NO_VALID_POI");
    }
    const r: OperationalReport = {
      decision: "WAIT",
      status,
      template: "NO_VALID_TEMPLATE",
      direction: bias.dominant,
      bias,
      primarySignal: null,
      reasons,
      summary: "",
      missing,
    };
    return { ...r, summary: describe(r) };
  }

  // ── Cross-check signal direction matches bias.
  if (dirToVote(signal.direction) !== bias.dominant) {
    const r: OperationalReport = {
      decision: "WAIT",
      status: "WATCHING",
      template: "NO_VALID_TEMPLATE",
      direction: bias.dominant,
      bias,
      primarySignal: null,
      reasons: ["DIRECTION_CONFLICT"],
      summary: "",
      missing: ["alineación señal/sesgo"],
    };
    return { ...r, summary: describe(r) };
  }

  const status = statusFromSignal(signal);
  const template = classifyTemplate(signal, elliott, ict, candleCount);

  // ARMED with pending order is still actionable. TRIGGERED ⇒ market.
  const decision = decisionFromSignal(signal);
  const reasonCode: DecisionReasonCode =
    status === "TRIGGERED" ? "MARKET_TRIGGERED"
    : status === "ARMED" ? "WAITING_RETRACE"
    : "OK";

  const r: OperationalReport = {
    decision,
    status,
    template,
    direction: bias.dominant,
    bias,
    primarySignal: signal,
    reasons: [reasonCode],
    summary: "",
    missing: [],
  };
  return { ...r, summary: describe(r) };
}