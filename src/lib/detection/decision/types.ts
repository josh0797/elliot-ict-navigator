/**
 * Operational Decision Layer — translates the canonical Elliott × ICT
 * snapshots and pre-gated TradeSignals into a single actionable decision
 * for the trader. Pure data; no I/O.
 */
import type { TradeSignal } from "../setup/types";

export type OperationalDecision = "BUY" | "SELL" | "WAIT" | "NO_TRADE";

export type OperationalSetupStatus =
  | "NO_SETUP"
  | "WATCHING"
  | "WAITING_FOR_SWEEP"
  | "WAITING_FOR_STRUCTURE_SHIFT"
  | "WAITING_FOR_RETRACE"
  | "ARMED"
  | "TRIGGERED"
  | "ACTIVE"
  | "PARTIAL_TP"
  | "TP1_HIT"
  | "TP2_HIT"
  | "STOPPED"
  | "EXPIRED"
  | "INVALIDATED";

export type SetupTemplate =
  | "ICT_BULLISH_REVERSAL"
  | "ICT_BEARISH_REVERSAL"
  | "BULLISH_CONTINUATION"
  | "BEARISH_CONTINUATION"
  | "ELLIOTT_WAVE_3_ENTRY"
  | "ELLIOTT_WAVE_5_ENTRY"
  | "ABC_COMPLETION_REVERSAL"
  | "NO_VALID_TEMPLATE";

export type VoteDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface DirectionVote {
  source: string;
  direction: VoteDirection;
  weight: number;
  reason: string;
}

export interface DirectionBiasResult {
  dominant: VoteDirection;
  bullScore: number;
  bearScore: number;
  conflict: boolean;
  votes: DirectionVote[];
}

export type DecisionReasonCode =
  | "NO_PRIMARY_COUNT"
  | "ELLIOTT_INVALIDATED"
  | "MANDATORY_RULE_FAIL"
  | "DIRECTION_CONFLICT"
  | "NO_VALID_POI"
  | "WAITING_RETRACE"
  | "MARKET_TRIGGERED"
  | "WAITING_FOR_STRUCTURE_SHIFT"
  | "WAITING_FOR_SWEEP"
  | "INSUFFICIENT_RR"
  | "NO_DOMINANT_BIAS"
  | "OK";

export interface OperationalReport {
  decision: OperationalDecision;
  status: OperationalSetupStatus;
  template: SetupTemplate;
  direction: VoteDirection;
  bias: DirectionBiasResult;
  /** The signal driving the decision, when actionable. */
  primarySignal: TradeSignal | null;
  reasons: DecisionReasonCode[];
  /** Human-readable summary in Spanish (project default). */
  summary: string;
  /** Optional list of what is missing to upgrade WAIT → BUY/SELL. */
  missing: string[];
}