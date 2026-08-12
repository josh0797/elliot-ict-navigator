import type { ElliottResultDTO } from "@/lib/detection/elliott/types";
import { Badge } from "@/components/ui/badge";

function statusTone(status: string): string {
  if (status === "INVALIDATED") return "text-destructive";
  if (status === "COMPLETED" || status === "VALID") return "text-success";
  return "text-foreground";
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
    <div className={`rounded border p-3 space-y-2 ${primary ? "border-primary/50 bg-primary/5" : "border-border/60"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{title}</span>
        <div className="flex items-center gap-1">
          {dto.timeframe && <Badge variant="outline" className="font-mono text-[10px]">{dto.timeframe}</Badge>}
          <Badge variant="outline" className={`font-mono text-[10px] ${statusTone(dto.status)}`}>{dto.status}</Badge>
        </div>
      </div>
      <div className="text-sm font-mono">
        <span className={dto.bias === "BULLISH" ? "text-success" : dto.bias === "BEARISH" ? "text-destructive" : ""}>
          {dto.bias}
        </span>{" "}
        · {dto.pattern.replace(/_/g, " ")} · W{dto.currentWave ?? "?"}
        {dto.nextWave ? ` → W${dto.nextWave}` : ""} · {dto.confidence}%
      </div>
      {dto.scenario && <p className="text-xs text-muted-foreground leading-relaxed">{dto.scenario}</p>}
      <div className="grid grid-cols-2 gap-x-3 text-xs font-mono">
        <span className="text-muted-foreground">Confirmación</span>
        <span className="text-right">{dto.confirmationLevel != null ? pxFmt(dto.confirmationLevel) : "—"}</span>
        <span className="text-muted-foreground">Invalidación</span>
        <span className="text-right text-destructive">{dto.invalidationLevel != null ? pxFmt(dto.invalidationLevel) : "—"}</span>
        <span className="text-muted-foreground">Completado</span>
        <span className="text-right">{Math.round(dto.completion * 100)}%</span>
      </div>
      {(dto.fibTargets ?? []).length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Objetivos Fibonacci</div>
          <ul className="text-xs font-mono space-y-0.5">
            {(dto.fibTargets ?? []).slice(0, 6).map((t) => (
              <li key={t.label} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t.label}</span>
                <span>{pxFmt(t.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScenariosPanel({
  elliott,
  macro,
  pxFmt,
}: {
  elliott: ElliottResultDTO | null;
  macro: ElliottResultDTO | null;
  pxFmt: (n: number) => string;
}) {
  if (!elliott) return null;
  const alt = elliott.alternatives[0] ?? null;
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Escenarios Elliott</div>
      <Scenario title="Principal (gráfico)" dto={elliott} pxFmt={pxFmt} primary />
      {alt && <Scenario title="Alternativo" dto={alt} pxFmt={pxFmt} />}
      {macro && <Scenario title="Macro (HTF)" dto={macro} pxFmt={pxFmt} />}
    </div>
  );
}