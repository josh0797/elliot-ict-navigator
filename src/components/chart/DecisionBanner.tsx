import type { OperationalReport } from "@/lib/detection/decision/types";
import { Badge } from "@/components/ui/badge";

const DECISION_STYLE: Record<OperationalReport["decision"], string> = {
  BUY: "border-success/40 bg-success/10 text-success",
  SELL: "border-destructive/40 bg-destructive/10 text-destructive",
  WAIT: "border-amber-400/40 bg-amber-400/10 text-amber-400",
  NO_TRADE: "border-muted bg-muted/30 text-muted-foreground",
};

export function DecisionBanner({
  report,
  pxFmt,
}: {
  report: OperationalReport;
  pxFmt: (n: number) => string;
}) {
  const cls = DECISION_STYLE[report.decision];
  const sig = report.primarySignal;
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-bold tracking-tight font-mono">{report.decision}</span>
        <Badge variant="outline" className="font-mono">{report.status}</Badge>
        <Badge variant="outline" className="font-mono">
          {report.template.replace(/_/g, " ")}
        </Badge>
        <Badge variant="outline" className="font-mono">
          BIAS · {report.direction} · 🐂{report.bias.bullScore.toFixed(1)} / 🐻{report.bias.bearScore.toFixed(1)}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-foreground/90">{report.summary}</p>

      {sig && (
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
              <span className="font-bold uppercase mr-2">{sig.trigger.type.replace(/_/g, " ")}</span>
              {sig.trigger.description}
            </div>
          )}
          <div className="text-xs">
            <span className="text-muted-foreground">Next: </span>
            <span className="text-foreground/90">{sig.nextAction}</span>
          </div>
        </div>
      )}

      {report.missing.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="text-muted-foreground">Falta: </span>
          <span className="text-foreground/90">{report.missing.join(" · ")}</span>
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