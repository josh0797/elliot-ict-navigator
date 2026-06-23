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
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
          <div><span className="text-muted-foreground">Entry </span>{pxFmt(sig.entry)}</div>
          <div><span className="text-muted-foreground">SL </span><span className="text-destructive">{pxFmt(sig.sl)}</span></div>
          <div><span className="text-muted-foreground">TP1 </span><span className="text-success">{pxFmt(sig.tp1)}</span></div>
          <div><span className="text-muted-foreground">TP2 </span><span className="text-success">{pxFmt(sig.tp2)}</span></div>
          <div><span className="text-muted-foreground">Order </span>{sig.orderType}</div>
          <div><span className="text-muted-foreground">RR </span>{sig.rrToTp1.toFixed(2)} / {sig.rrToTp2.toFixed(2)}</div>
          <div><span className="text-muted-foreground">POI </span>{sig.poi.kind}</div>
          <div><span className="text-muted-foreground">Score </span>{Math.round(sig.score * 100)}%</div>
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