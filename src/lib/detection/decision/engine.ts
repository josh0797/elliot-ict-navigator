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

const DEFAULT_MIN_RR = 1.5;

/** Defense-in-depth structural validation — never trust upstream alone. */
function signalIsStructurallyValid(s: TradeSignal, minRR: number): boolean {
  if (!Number.isFinite(s.entry) || !Number.isFinite(s.sl) || !Number.isFinite(s.tp1)) return false;
  if (!Number.isFinite(s.rrToTp1) || s.rrToTp1 < minRR) return false;
  if (s.direction === "long") {
    if (!(s.sl < s.entry && s.entry < s.tp1)) return false;
  } else {
    if (!(s.tp1 < s.entry && s.entry < s.sl)) return false;
  }
  return true;
}

const PENDING_ORDER_TYPES = new Set([
  "BUY_LIMIT", "SELL_LIMIT", "BUY_STOP", "SELL_STOP",
]);

const MANDATORY_RULES = ["W2_ORIGIN", "W3_NOT_SHORTEST", "W4_OVERLAP"] as const;

/**
 * Mandatory-rule aliases. The internal Elliott engine emits invalidations as
 * legacy short codes (`R1:`, `R2:`, `R3:`), while the public DTO and external
 * contracts use the canonical codes (`W2_ORIGIN`, `W3_NOT_SHORTEST`, `W4_OVERLAP`).
 * We accept both so a rule failure is never silently missed.
 */
const MANDATORY_RULE_ALIASES: Record<(typeof MANDATORY_RULES)[number], readonly string[]> = {
  W2_ORIGIN: ["W2_ORIGIN", "R1:"],
  W3_NOT_SHORTEST: ["W3_NOT_SHORTEST", "R2:"],
  W4_OVERLAP: ["W4_OVERLAP", "R3:"],
};

function hasMandatoryFailure(invalidations: readonly string[]): boolean {
  return MANDATORY_RULES.some((code) =>
    MANDATORY_RULE_ALIASES[code].some((alias) =>
      invalidations.some((v) => v.includes(alias)),
    ),
  );
}

function pickSignalForDirection(
  signals: ReadonlyArray<TradeSignal>,
  dir: "long" | "short",
  minRR: number,
): TradeSignal | null {
  const matching = signals
    .filter((s) => s.direction === dir)
    .filter((s) => s.status !== "INVALIDATED" && s.status !== "NO_SETUP")
    .filter((s) => signalIsStructurallyValid(s, minRR))
    .sort((a, b) => b.score - a.score);
  return matching[0] ?? null;
}

function statusFromSignal(signal: TradeSignal): OperationalSetupStatus {
  switch (signal.status) {
    case "TRIGGERED": return "TRIGGERED";
    case "WAITING_RETRACE":
      // Only "armed" when a concrete pending order can be placed; otherwise
      // the user is still waiting for the retrace to materialise.
      return PENDING_ORDER_TYPES.has(signal.orderType) ? "ARMED" : "WAITING_FOR_RETRACE";
    case "READY": return "ARMED";
    case "INVALIDATED": return "INVALIDATED";
    case "NO_SETUP": return "NO_SETUP";
    default: return "WATCHING";
  }
}

function decisionFromSignal(signal: TradeSignal): OperationalDecision {
  // Actionable BUY/SELL only when:
  //  - The market has already triggered the setup, OR
  //  - The setup carries a concrete pending order type (LIMIT/STOP).
  // A plain "WAITING_RETRACE" without a pending order means the trader has
  // nothing to place yet — surface as WAIT, not BUY/SELL.
  const actionable =
    signal.status === "TRIGGERED" ||
    PENDING_ORDER_TYPES.has(signal.orderType);
  if (!actionable) return "WAIT";
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
  opts: DecisionEngineOptions = {},
): OperationalReport {
  const minRR = opts.minRR ?? DEFAULT_MIN_RR;
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
  const mandatoryFailed = hasMandatoryFailure(primaryRules);
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
  const signal = pickSignalForDirection(signals, dirSide, minRR);

  // If a directional candidate exists but failed RR/finite/side defense,
  // surface explicitly instead of falling through to "no signal".
  if (!signal && signals.some((s) => s.direction === dirSide)) {
    const r: OperationalReport = {
      decision: "WAIT",
      status: "WATCHING",
      template: "NO_VALID_TEMPLATE",
      direction: bias.dominant,
      bias,
      primarySignal: null,
      reasons: ["INSUFFICIENT_RR"],
      summary: "",
      missing: [`RR mínimo ${minRR}`],
    };
    return { ...r, summary: describe(r) };
  }

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

  // BUY/SELL only when armed-with-pending-order or already triggered.
  const decision = decisionFromSignal(signal);
  const reasonCode: DecisionReasonCode =
    status === "TRIGGERED" ? "MARKET_TRIGGERED"
    : status === "ARMED" ? "WAITING_RETRACE"
    : status === "WAITING_FOR_RETRACE" ? "WAITING_RETRACE"
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