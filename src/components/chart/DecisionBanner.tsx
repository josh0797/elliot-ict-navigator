import type { OperationalReport } from "@/lib/detection/decision/types";
import { Badge } from "@/components/ui/badge";

const DECISION_STYLE: Record<OperationalReport["decision"], string> = {
  BUY: "border-success/50 bg-success/10",
  SELL: "border-destructive/50 bg-destructive/10",
  WAIT: "border-amber-400/50 bg-amber-400/10",
  NO_TRADE: "border-muted bg-muted/30",
};

const DECISION_HEADLINE: Record<OperationalReport["decision"], string> = {
  BUY: "COMPRAR",
  SELL: "VENDER",
  WAIT: "ESPERAR",
  NO_TRADE: "NO OPERAR",
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
}: {
  report: OperationalReport;
  pxFmt: (n: number) => string;
}) {
  const cls = DECISION_STYLE[report.decision];
  const headlineCls = DECISION_TEXT[report.decision];
  const sig = report.primarySignal;
  return (
    <div className={`rounded-lg border p-5 ${cls}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-3xl font-extrabold tracking-tight font-mono ${headlineCls}`}>
          {DECISION_HEADLINE[report.decision]}
        </span>
        {sig && (report.decision === "BUY" || report.decision === "SELL") && (
          <Badge variant="outline" className={`font-mono ${headlineCls}`}>
            {sig.orderType.replace(/_/g, " ")}
          </Badge>
        )}
        <Badge variant="outline" className="font-mono">{report.status}</Badge>
        <Badge variant="outline" className="font-mono">
          {report.template.replace(/_/g, " ")}
        </Badge>
        <Badge variant="outline" className="font-mono">
          BIAS · {report.direction} · 🐂{report.bias.bullScore.toFixed(1)} / 🐻{report.bias.bearScore.toFixed(1)}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-foreground/90">{report.summary}</p>

      {sig && (report.decision === "BUY" || report.decision === "SELL") && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
            <div><span className="text-muted-foreground">Order </span>{sig.orderType}</div>
            <div><span className="text-muted-foreground">Entry </span>{pxFmt(sig.entry)}</div>
            <div><span className="text-muted-foreground">SL </span><span className="text-destructive">{pxFmt(sig.sl)}</span> <span className="text-muted-foreground">({sig.stopReason})</span></div>
            <div><span className="text-muted-foreground">Score </span>{sig.scoreOut100}/100 · {sig.grade}</div>
            <div className="col-span-2 sm:col-span-4">
              <span className="text-muted-foreground">Zona </span>
              {pxFmt(sig.entryZone.bottom)}–{pxFmt(sig.entryZone.top)}
              <span className="text-muted-foreground"> · POI </span>{sig.selectedPoi?.type ?? sig.poi.kind}
              <span className="text-muted-foreground"> · política </span>{sig.entryPolicy}
            </div>
          </div>
          <table className="w-full text-xs font-mono">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left">Target</th><th className="text-right">Precio</th>
                <th className="text-right">RR</th><th className="text-right">%</th>
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
          {sig.trigger && (
            <div className={`rounded border p-2 text-xs ${sig.trigger.satisfied ? "border-success/40 bg-success/5" : "border-amber-400/40 bg-amber-400/5"}`}>
              <span className="font-bold uppercase mr-2">Activación · {sig.trigger.type.replace(/_/g, " ")}</span>
              {sig.trigger.description}
            </div>
          )}
          {sig.invalidation.price !== null && (
            <div className="text-xs text-muted-foreground">
              Cancelar escenario si: cierre cruza <span className="font-mono text-destructive">{pxFmt(sig.invalidation.price)}</span>
              {sig.invalidation.reason ? ` (${sig.invalidation.reason})` : ""}
            </div>
          )}
          <div className="text-xs">
            <span className="text-muted-foreground">Próxima acción: </span>
            <span className="text-foreground/90">{sig.nextAction}</span>
          </div>
        </div>
      )}

      {report.decision === "WAIT" && (
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Sesgo: </span>
            <span className="text-foreground">
              {report.direction === "BULLISH" ? "Alcista potencial" : report.direction === "BEARISH" ? "Bajista potencial" : "Sin sesgo claro"}
            </span>
          </div>
          {report.missing.length > 0 && (
            <div>
              <span className="text-muted-foreground">Falta: </span>
              <span className="text-foreground/90">{report.missing.join(" · ")}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">No operar todavía. El sistema seguirá vigilando la estructura.</div>
        </div>
      )}

      {report.decision === "NO_TRADE" && (
        <div className="mt-3 space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Motivo: </span>
            <span className="text-foreground/90 font-mono">
              {report.reasons[0] ?? "NO_VALID_SETUP"}
            </span>
          </div>
          {report.reasons.length > 1 && (
            <div className="text-xs text-muted-foreground font-mono">
              {report.reasons.slice(1).join(" · ")}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            El sistema continuará buscando un conteo alternativo válido.
          </div>
        </div>
      )}

      {report.bias.votes.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Votación direccional ({report.bias.votes.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono">
            {report.bias.votes.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{v.source}</span>
                <span className={
                  v.direction === "BULLISH" ? "text-success"
                  : v.direction === "BEARISH" ? "text-destructive"
                  : "text-muted-foreground"
                }>{v.direction} · {v.weight.toFixed(1)}</span>
                <span className="text-foreground/70 flex-1 text-right">{v.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}