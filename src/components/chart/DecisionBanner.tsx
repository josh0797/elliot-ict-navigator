import type { OperationalReport } from "@/lib/detection/decision/types";
import { Badge } from "@/components/ui/badge";
import { explainPlain, humanizeToken, reasonEs } from "@/lib/detection/decision/plain-es";

const DECISION_STYLE: Record<OperationalReport["decision"], string> = {
  BUY: "border-success/50 bg-success/10",
  SELL: "border-destructive/50 bg-destructive/10",
  WAIT: "border-amber-400/50 bg-amber-400/10",
  NO_TRADE: "border-muted bg-muted/30",
};

const DECISION_TEXT: Record<OperationalReport["decision"], string> = {
  BUY: "text-success",
  SELL: "text-destructive",
  WAIT: "text-amber-400",
  NO_TRADE: "text-muted-foreground",
};

export function DecisionBanner({
  report,
  pxFmt,
  mode = "operational",
}: {
  report: OperationalReport;
  pxFmt: (n: number) => string;
  /** Operational = plain Spanish; Diagnostic = technical block expanded. */
  mode?: "operational" | "diagnostic";
}) {
  const cls = DECISION_STYLE[report.decision];
  const headlineCls = DECISION_TEXT[report.decision];
  const sig = report.primarySignal;
  const plain = explainPlain(report, pxFmt);
  const actionable = report.decision === "BUY" || report.decision === "SELL";

  return (
    <div className={`rounded-lg border p-5 ${cls}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Acción actual
        </span>
        <span className={`text-3xl font-extrabold tracking-tight font-mono ${headlineCls}`}>
          {plain.action}
        </span>
        <Badge variant="outline" className="text-[11px]">
          {plain.status}
        </Badge>
        {sig && actionable && (
          <Badge variant="outline" className={`font-mono ${headlineCls}`}>
            {sig.orderType.replace(/_/g, " ")}
          </Badge>
        )}
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <Line label="Por qué">{plain.why}</Line>
        {plain.confirms.length > 0 && (
          <Line label="Qué confirma la entrada">{plain.confirms.join(" · ")}</Line>
        )}
        {plain.missing.length > 0 && <Line label="Qué falta">{plain.missing.join(" · ")}</Line>}
        {plain.invalidation && <Line label="Invalidación">{plain.invalidation}</Line>}
        <Line label="Contexto">{plain.context}</Line>
      </div>

      {sig && actionable && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
            <div>
              <span className="text-muted-foreground">Entrada </span>
              {pxFmt(sig.entry)}
            </div>
            <div>
              <span className="text-muted-foreground">Stop </span>
              <span className="text-destructive">{pxFmt(sig.sl)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Calidad </span>
              {sig.scoreOut100}/100 · {sig.grade}
            </div>
            <div>
              <span className="text-muted-foreground">Zona </span>
              {pxFmt(sig.entryZone.bottom)}–{pxFmt(sig.entryZone.top)}
            </div>
          </div>
          <table className="w-full text-xs font-mono">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left">Objetivo</th>
                <th className="text-right">Precio</th>
                <th className="text-right">RR</th>
                <th className="text-right">%</th>
                <th className="text-left pl-3">Razón</th>
              </tr>
            </thead>
            <tbody>
              {sig.targets.map((t) => (
                <tr key={t.name}>
                  <td className="text-success">{t.name}</td>
                  <td className="text-right">{pxFmt(t.price)}</td>
                  <td className="text-right">{t.rr.toFixed(2)}</td>
                  <td className="text-right">{t.allocationPct}%</td>
                  <td className="text-left pl-3 text-muted-foreground">{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-xs">
            <span className="text-muted-foreground">Próxima acción: </span>
            <span className="text-foreground/90">{sig.nextAction}</span>
          </div>
        </div>
      )}

      <details className="mt-4 text-xs" open={mode === "diagnostic"}>
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Ver detalles técnicos
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <Badge variant="outline" className="font-mono">
              {report.status}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {report.template.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="font-mono">
              BIAS · {report.direction} · 🐂{report.bias.bullScore.toFixed(1)} / 🐻
              {report.bias.bearScore.toFixed(1)}
            </Badge>
            {report.biasSplit && (
              <>
                <Badge variant="outline" className="font-mono">
                  Elliott {report.biasSplit.elliottBias} {report.biasSplit.elliottScore.toFixed(1)}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  ICT {report.biasSplit.ictBias} {report.biasSplit.ictScore.toFixed(1)}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  FINAL {report.biasSplit.finalBias}
                </Badge>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{report.summary}</p>
          {report.reasons.length > 0 && (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {report.reasons.map((r) => (
                <li key={r} className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{r}</span>
                  <span className="flex-1 text-right text-foreground/80">{reasonEs(r)}</span>
                </li>
              ))}
            </ul>
          )}
          {report.missing.length > 0 && (
            <div className="font-mono text-[11px] text-muted-foreground">
              missing: {report.missing.map((m) => `${m} (${humanizeToken(m)})`).join(" · ")}
            </div>
          )}
          {sig && (
            <div className="font-mono text-[11px] text-muted-foreground space-y-0.5">
              <div>
                POI {sig.selectedPoi?.type ?? sig.poi.kind} · política {sig.entryPolicy} · stop{" "}
                {sig.stopReason}
              </div>
              {sig.trigger && (
                <div>
                  trigger {sig.trigger.type} ·{" "}
                  {sig.trigger.satisfied ? "satisfied" : "not satisfied"} —{" "}
                  {sig.trigger.description}
                </div>
              )}
            </div>
          )}
          {report.bias.votes.length > 0 && (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {report.bias.votes.map((v, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{v.source}</span>
                  <span
                    className={
                      v.direction === "BULLISH"
                        ? "text-success"
                        : v.direction === "BEARISH"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {v.direction} · {v.weight.toFixed(1)}
                  </span>
                  <span className="flex-1 text-right text-foreground/70">{v.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground sm:w-48">
        {label}
      </span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}
