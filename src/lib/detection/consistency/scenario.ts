/**
 * Central coherence rule between Elliott, Fibonacci targets, count state and
 * ICT. Runs AFTER the Elliott engine (the engine itself is untouched) and
 * corrects any scenario before it is rendered.
 *
 * Responsibilities:
 *  1. Dynamic Fibonacci targets (HIT / ACTIVE / NEXT / PENDING).
 *  2. Retire obsolete scenarios (STALE / INVALIDATED, confidence 0).
 *  3. Normalise the status machine (DEVELOPING / NEAR_COMPLETION /
 *     COMPLETED / INVALIDATED / STALE) and keep the narrative in sync.
 *  4. Require >= 2 exhaustion signals before declaring a wave COMPLETED.
 */
import type { CandleV2 } from "../schemas/analysis";
import type { IctContext } from "../ict/types";
import type { ConsistencyIssueCode, ElliottResultDTO, FibTargetDTO } from "../elliott/types";
import { collectExhaustion, isTerminationConfirmed } from "./exhaustion";
import { evaluateTruncation } from "../elliott/truncation";
import { atr14 } from "../indicators/atr";

export interface ConsistencyContext {
  currentPrice: number;
  candles?: ReadonlyArray<CandleV2>;
  ict?: IctContext | null;
}

function dirOf(dto: ElliottResultDTO): "long" | "short" {
  return dto.bias === "BEARISH" ? "short" : "long";
}

/** Assign HIT / ACTIVE / NEXT / PENDING to every Fibonacci target. */
export function annotateTargets(
  targets: ReadonlyArray<FibTargetDTO>,
  direction: "long" | "short",
  price: number,
): {
  targets: FibTargetDTO[];
  hit: FibTargetDTO[];
  active: FibTargetDTO | null;
  next: FibTargetDTO | null;
  allExceeded: boolean;
} {
  const reached = (t: FibTargetDTO) => {
    const projection = t.kind !== "RETRACEMENT";
    if (direction === "long") return projection ? price >= t.price : price <= t.price;
    return projection ? price <= t.price : price >= t.price;
  };

  const directional = targets
    .filter((t) => t.kind !== "RETRACEMENT")
    .slice()
    .sort((a, b) => (direction === "long" ? a.price - b.price : b.price - a.price));

  const annotated = new Map<FibTargetDTO, FibTargetDTO["state"]>();
  let pendingSeen = 0;
  for (const t of directional) {
    if (reached(t)) {
      annotated.set(t, "HIT");
    } else {
      pendingSeen += 1;
      annotated.set(t, pendingSeen === 1 ? "ACTIVE" : pendingSeen === 2 ? "NEXT" : "PENDING");
    }
  }
  for (const t of targets) {
    if (!annotated.has(t)) annotated.set(t, reached(t) ? "HIT" : "PENDING");
  }

  const out = targets.map((t) => ({ ...t, state: annotated.get(t) }));
  const byRef = (state: FibTargetDTO["state"]) => out.filter((t) => t.state === state);
  const hit = byRef("HIT");
  const active = byRef("ACTIVE")[0] ?? null;
  const next = byRef("NEXT")[0] ?? null;
  const allExceeded = directional.length > 0 && directional.every((t) => reached(t));

  return { targets: out, hit, active, next, allExceeded };
}

function narrative(dto: ElliottResultDTO): string {
  const dir = dto.bias === "BEARISH" ? "bajista" : dto.bias === "BULLISH" ? "alcista" : "neutral";
  const cw = dto.currentWave ?? "?";
  const pat = dto.pattern.replace(/_/g, " ").toLowerCase();
  switch (dto.status) {
    case "INVALIDATED":
      return `Conteo ${dir} invalidado: el precio perforó el nivel de invalidación. Se requiere recuento.`;
    case "STALE":
      return `Escenario ${dir} obsoleto: el precio excedió todos sus objetivos. Sin validez operativa; se busca conteo alternativo.`;
    case "NEAR_COMPLETION":
      return `Estructura ${pat} ${dir}: onda ${cw} en zona Fibonacci objetivo con señales de agotamiento. Falta confirmación estructural para darla por terminada.`;
    case "COMPLETED":
      return `Estructura ${pat} ${dir}: onda ${cw} terminada con evidencia estructural; se espera la corrección siguiente${dto.nextWave ? ` (onda ${dto.nextWave})` : ""}.`;
    default:
      return `Estructura ${pat} ${dir}: onda ${cw} en curso${dto.nextWave ? `; siguiente esperada: onda ${dto.nextWave}` : ""}.`;
  }
}

function checkOne(dto: ElliottResultDTO, ctx: ConsistencyContext): ElliottResultDTO {
  if (dto.status === "NO_COUNT") return dto;
  const issues: ConsistencyIssueCode[] = [];
  const direction = dirOf(dto);
  const price = ctx.currentPrice;

  const ann = annotateTargets(dto.fibTargets ?? [], direction, price);
  const out: ElliottResultDTO = {
    ...dto,
    fibTargets: ann.targets,
    hitTargets: ann.hit,
    activeTarget: ann.active,
    nextTarget: ann.next,
  };
  if (ann.hit.length > 0 && ann.active === null && ann.allExceeded) {
    issues.push("ALL_TARGETS_EXCEEDED");
  }
  if (ann.hit.some((t) => t.kind !== "RETRACEMENT")) issues.push("TARGET_BELOW_PRICE");

  // ── Invalidation breach ────────────────────────────────────────────────────
  const inv = out.invalidationLevel;
  const breached =
    inv !== null && Number.isFinite(inv) && (direction === "long" ? price < inv : price > inv);

  // ── Exhaustion evidence ────────────────────────────────────────────────────
  const exhaustion = collectExhaustion({
    dto: out,
    candles: ctx.candles,
    ict: ctx.ict,
    currentPrice: price,
    targetReached: ann.hit.length > 0,
  });
  const confirmed = isTerminationConfirmed(exhaustion);

  // ── Truncated fifth: re-evaluated with internal subwaves + exhaustion ─────
  let truncation = out.truncation ?? null;
  if (truncation) {
    const priceOf = (label: string) => out.waves.find((w) => w.label === label)?.price;
    const failed = out.rules.filter((r) => r.status === "FAIL").map((r) => r.code);
    const invalidations = [
      ...(failed.includes("W2_ORIGIN") ? ["R1: wave 2 past origin"] : []),
      ...(failed.includes("W3_NOT_SHORTEST") ? ["R2: wave 3 shortest"] : []),
      ...(failed.includes("W4_OVERLAP") ? ["R3: wave 4 overlap"] : []),
    ];
    const atrSeries = ctx.candles && ctx.candles.length >= 15 ? atr14(ctx.candles) : null;
    const atr = atrSeries ? atrSeries[atrSeries.length - 1] : undefined;
    truncation = evaluateTruncation({
      direction,
      pattern: out.pattern,
      p0: priceOf("0"),
      p1: priceOf("1"),
      p2: priceOf("2"),
      p3: priceOf("3"),
      p4: priceOf("4"),
      p5: priceOf("5"),
      invalidations,
      internalLabels: (out.internal?.waves ?? []).map((w) => w.label),
      exhaustion,
      invalidationBreached: breached,
      atr: Number.isFinite(atr) ? atr : undefined,
    });
    out.truncation = truncation;
    if (truncation.verdict === "CONFIRMED") out.scenarioKind = "TRUNCATED_FIFTH";
    else if (truncation.verdict === "UNCONFIRMED") out.scenarioKind = "UNCONFIRMED";
  }
  const truncationUnconfirmed = truncation?.verdict === "UNCONFIRMED";

  // ── Status normalisation ───────────────────────────────────────────────────
  let status = out.status;
  if (breached) {
    if (status !== "INVALIDATED") issues.push("INVALIDATION_BREACHED");
    status = "INVALIDATED";
  } else if (ann.allExceeded && !confirmed) {
    issues.push("STALE_SCENARIO");
    status = "STALE";
  } else if (status === "COMPLETED" && (!confirmed || truncationUnconfirmed)) {
    issues.push("COMPLETED_WITHOUT_EVIDENCE");
    status = ann.hit.length > 0 ? "NEAR_COMPLETION" : "DEVELOPING";
  } else if (status === "VALID" || status === "DEVELOPING") {
    if (confirmed && ann.hit.length > 0 && !truncationUnconfirmed) status = "COMPLETED";
    else if (ann.hit.length > 0 || exhaustion.length >= 1) status = "NEAR_COMPLETION";
    else status = "DEVELOPING";
  }

  out.status = status;
  const dead = status === "INVALIDATED" || status === "STALE";
  if (dead) out.confidence = 0;
  if (dead) out.nextWave = null;

  const prevScenario = out.scenario;
  out.scenario = narrative(out);
  if (truncation?.verdict === "CONFIRMED") {
    out.scenario = `TRUNCATED FIFTH — ${out.scenario}`;
  } else if (truncationUnconfirmed) {
    out.scenario = `POSSIBLE TRUNCATED FIFTH — UNCONFIRMED. ${out.scenario}`;
  }
  if (prevScenario && prevScenario !== out.scenario && (status === "COMPLETED" || dead)) {
    issues.push("STATUS_TEXT_MISMATCH");
  }

  out.consistency = {
    issues: Array.from(new Set(issues)),
    corrected: issues.length > 0,
    exhaustion,
    stale: dead,
    priceAtCheck: price,
  };
  return out;
}

export interface ScenarioCheckResult {
  scenario: ElliottResultDTO;
  /** True when the primary scenario is no longer tradable (STALE/INVALIDATED). */
  primaryRetired: boolean;
  /** Alternative promoted because the primary was retired. */
  promoted: ElliottResultDTO | null;
  issues: ConsistencyIssueCode[];
}

/**
 * Full check: primary + internal subdivision + alternatives. When the primary
 * scenario is retired, the best surviving alternative is promoted so a fresh
 * alternative count is always available.
 */
export function scenarioConsistencyCheck(
  dto: ElliottResultDTO,
  ctx: ConsistencyContext,
): ScenarioCheckResult {
  const base = checkOne(dto, ctx);
  if (base.internal) base.internal = checkOne(base.internal, ctx);
  const alternatives = (dto.alternatives ?? []).map((a) => checkOne(a, ctx));
  base.alternatives = alternatives;

  const retired = base.consistency?.stale === true;
  let promoted: ElliottResultDTO | null = null;
  if (retired) {
    const alive = alternatives
      .filter((a) => a.consistency?.stale !== true && a.status !== "NO_COUNT")
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (alive) {
      promoted = alive;
      base.consistency = {
        ...base.consistency!,
        issues: Array.from(new Set([...base.consistency!.issues, "ALTERNATIVE_PROMOTED"])),
        corrected: true,
      };
      // Surface the promoted count first so the UI reads it as the live option.
      base.alternatives = [alive, ...alternatives.filter((a) => a !== alive)];
    }
  }

  return {
    scenario: base,
    primaryRetired: retired,
    promoted,
    issues: base.consistency?.issues ?? [],
  };
}
