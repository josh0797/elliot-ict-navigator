import type { ElliottResultDTO } from "@/lib/detection/elliott/types";
import { Badge } from "@/components/ui/badge";
import { degreeColor, displayWaveLabel } from "@/lib/detection/elliott/display";
import { plainScenario } from "@/lib/detection/elliott/plain-es";

function statusTone(status: string): string {
  if (status === "INVALIDATED" || status === "STALE") return "text-destructive";
  if (status === "COMPLETED") return "text-success";
  if (status === "NEAR_COMPLETION") return "text-amber-400";
  return "text-foreground";
}

const TARGET_TONE: Record<string, string> = {
  HIT: "text-success line-through decoration-success/60",
  ACTIVE: "text-primary font-bold",
  NEXT: "text-foreground",
  PENDING: "text-muted-foreground",
};

function TruncationDiagnostics({
  dto,
  pxFmt,
}: {
  dto: ElliottResultDTO;
  pxFmt: (n: number) => string;
}) {
  const t = dto.truncation;
  if (!t || t.verdict === "NONE") return null;
  const confirmed = t.verdict === "CONFIRMED";
  const abcReason = (dto.notes ?? []).find((n) => n.startsWith("ABC lost"));
  return (
    <div
      className={`rounded border p-2 space-y-1 ${confirmed ? "border-amber-400/60" : "border-border/60"}`}
    >
      <div
        className={`text-[11px] font-mono uppercase tracking-wider ${confirmed ? "text-amber-400" : "text-muted-foreground"}`}
      >
        {confirmed ? "TRUNCATED FIFTH" : "POSSIBLE TRUNCATED FIFTH — UNCONFIRMED"}
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-[11px] font-mono">
        <span className="text-muted-foreground">Extremo onda 3</span>
        <span className="text-right">{t.wave3Extreme != null ? pxFmt(t.wave3Extreme) : "—"}</span>
        <span className="text-muted-foreground">Extremo onda 5</span>
        <span className="text-right">{t.wave5Extreme != null ? pxFmt(t.wave5Extreme) : "—"}</span>
        <span className="text-muted-foreground">Diferencia</span>
        <span className="text-right">
          {t.gapPrice != null ? pxFmt(t.gapPrice) : "—"}
          {t.gapAtr != null ? ` · ${t.gapAtr.toFixed(2)} ATR` : ""}
        </span>
        <span className="text-muted-foreground">Subondas internas</span>
        <span className="text-right">{t.internalSubwaves}/5</span>
        <span className="text-muted-foreground">Agotamiento</span>
        <span className="text-right">
          {t.exhaustion.length > 0 ? t.exhaustion.join(" · ") : "—"}
        </span>
      </div>
      {!confirmed && t.missing.length > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground">
          Falta: {t.missing.join(" · ")}
        </div>
      )}
      {abcReason && <div className="text-[10px] font-mono text-muted-foreground">{abcReason}</div>}
    </div>
  );
}

function Scenario({
  title,
  dto,
  pxFmt,
  primary,
}: {
  title: string;
  dto: ElliottResultDTO;
  pxFmt: (n: number) => string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded border p-3 space-y-2 ${primary ? "border-primary/50 bg-primary/5" : "border-border/60"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{title}</span>
        <div className="flex items-center gap-1">
          {dto.degree && (
            <Badge
              variant="outline"
              className="font-mono text-[10px]"
              style={{ color: degreeColor(dto.degree), borderColor: degreeColor(dto.degree) }}
            >
              {dto.degree}
            </Badge>
          )}
          {dto.timeframe && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {dto.timeframe}
            </Badge>
          )}
          <Badge variant="outline" className={`font-mono text-[10px] ${statusTone(dto.status)}`}>
            {dto.status}
          </Badge>
        </div>
      </div>
      <div className="text-sm font-mono">
        <span
          className={
            dto.bias === "BULLISH"
              ? "text-success"
              : dto.bias === "BEARISH"
                ? "text-destructive"
                : ""
          }
        >
          {dto.bias}
        </span>{" "}
        · {dto.pattern.replace(/_/g, " ")} · W{dto.currentWave ?? "?"}
        {dto.currentWave ? ` (${displayWaveLabel(dto.currentWave, dto.degree)})` : ""}
        {dto.nextWave ? ` → W${dto.nextWave}` : ""} · {dto.confidence}%
      </div>
      {dto.scenario && (
        <p className="text-xs text-muted-foreground leading-relaxed">{dto.scenario}</p>
      )}
      <TruncationDiagnostics dto={dto} pxFmt={pxFmt} />
      {(dto.hypotheses ?? []).length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Hipótesis
          </div>
          <ul className="text-[11px] font-mono space-y-0.5">
            {(dto.hypotheses ?? []).slice(0, 4).map((h, i) => (
              <li key={`${h.kind}-${i}`} className="flex justify-between gap-2">
                <span className="truncate">{h.kind.replace(/_/g, " ")}</span>
                <span className="whitespace-nowrap">{h.score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-3 text-xs font-mono">
        <span className="text-muted-foreground">Confirmación</span>
        <span className="text-right">
          {dto.confirmationLevel != null ? pxFmt(dto.confirmationLevel) : "—"}
        </span>
        <span className="text-muted-foreground">Invalidación</span>
        <span className="text-right text-destructive">
          {dto.invalidationLevel != null ? pxFmt(dto.invalidationLevel) : "—"}
        </span>
        <span className="text-muted-foreground">Objetivo activo</span>
        <span className="text-right text-primary">
          {dto.activeTarget ? pxFmt(dto.activeTarget.price) : "—"}
        </span>
        <span className="text-muted-foreground">Siguiente</span>
        <span className="text-right">{dto.nextTarget ? pxFmt(dto.nextTarget.price) : "—"}</span>
        <span className="text-muted-foreground">Alcanzados</span>
        <span className="text-right text-success">{(dto.hitTargets ?? []).length}</span>
        <span className="text-muted-foreground">Completado</span>
        <span className="text-right">{Math.round(dto.completion * 100)}%</span>
      </div>
      {(dto.fibTargets ?? []).length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Objetivos Fibonacci
          </div>
          <ul className="text-xs font-mono space-y-0.5">
            {(dto.fibTargets ?? []).slice(0, 6).map((t) => (
              <li
                key={t.label}
                className={`flex justify-between gap-2 ${TARGET_TONE[t.state ?? "PENDING"]}`}
              >
                <span className="truncate">{t.label}</span>
                <span className="whitespace-nowrap">
                  {pxFmt(t.price)}
                  {t.state && t.state !== "PENDING" ? ` · ${t.state}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dto.consistency && dto.consistency.exhaustion.length > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground">
          Agotamiento ({dto.consistency.exhaustion.length}/2):{" "}
          {dto.consistency.exhaustion.join(" · ")}
        </div>
      )}
      {dto.consistency?.corrected && (
        <div className="text-[10px] font-mono text-amber-400">
          Corregido: {dto.consistency.issues.join(" · ")}
        </div>
      )}
    </div>
  );
}

const TONE_CLS: Record<string, string> = {
  ok: "text-success",
  warn: "text-amber-400",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Plain-Spanish scenario card used in the Operational view. */
function PlainScenarioCard({
  title,
  dto,
  pxFmt,
  primary,
}: {
  title: string;
  dto: ElliottResultDTO;
  pxFmt: (n: number) => string;
  primary?: boolean;
}) {
  const p = plainScenario(dto, pxFmt);
  return (
    <div
      className={`rounded border p-3 space-y-1.5 ${primary ? "border-primary/50 bg-primary/5" : "border-border/60"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{title}</span>
        <Badge variant="outline" className={`text-[10px] ${TONE_CLS[p.stateTone]}`}>
          {p.state}
        </Badge>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground text-xs">Dirección: </span>
        <span
          className={
            p.directionTone === "up"
              ? "text-success"
              : p.directionTone === "down"
                ? "text-destructive"
                : ""
          }
        >
          {p.direction}
        </span>
        <span className="text-muted-foreground text-xs"> · confianza {p.confidence}%</span>
      </div>
      <p className="text-xs text-foreground/90 leading-relaxed">{p.expectation}</p>
      <div className="grid grid-cols-2 gap-x-3 text-xs">
        <span className="text-muted-foreground">Nivel que lo invalida</span>
        <span className="text-right font-mono text-destructive">{p.invalidation ?? "—"}</span>
        <span className="text-muted-foreground">Próximo objetivo</span>
        <span className="text-right font-mono text-primary">{p.target ?? "—"}</span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Ver detalles técnicos
        </summary>
        <div className="mt-2">
          <Scenario title={title} dto={dto} pxFmt={pxFmt} />
        </div>
      </details>
    </div>
  );
}

export function ScenariosPanel({
  elliott,
  macro,
  pxFmt,
  mode = "diagnostic",
}: {
  elliott: ElliottResultDTO | null;
  macro: ElliottResultDTO | null;
  pxFmt: (n: number) => string;
  mode?: "operational" | "diagnostic";
}) {
  if (!elliott) return null;
  const alt = elliott.alternatives[0] ?? null;
  const Card = mode === "operational" ? PlainScenarioCard : Scenario;
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        Escenarios Elliott
      </div>
      <Card title="Principal" dto={elliott} pxFmt={pxFmt} primary />
      {alt && <Card title="Alternativo" dto={alt} pxFmt={pxFmt} />}
      {macro && <Card title="Macro (HTF)" dto={macro} pxFmt={pxFmt} />}
    </div>
  );
}
