import type { TradeSignal } from "@/lib/detection/setup/types";
import type { OperationalReport } from "@/lib/detection/decision/types";

const CONFLUENCE_LABELS: Record<string, string> = {
  BIAS_ALIGN: "Bias",
  WAVE_ENTRY_ZONE: "Wave 2/4/B",
  OB_CONFLUENCE: "Order Block",
  FVG_CONFLUENCE: "FVG",
  SWEEP_RECENT: "Sweep",
  STRUCTURE_CONFIRMED: "BOS/CHoCH",
  PD_ALIGNED: "Premium/Discount",
  KILLZONE_ACTIVE: "Killzone",
};

export function SignalsPanel({
  signals,
  report,
  selectedId,
  onSelect,
  pxFmt,
}: {
  signals: TradeSignal[];
  report?: OperationalReport | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  pxFmt: (n: number) => string;
}) {
  const header = report ? <DecisionHeader report={report} pxFmt={pxFmt} /> : null;

  if (signals.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Señales (diagnóstico)</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Sin confluencia operativa en las velas recientes. El motor seguirá observando.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Señales — diagnóstico ({signals.length})
        </div>
        {selectedId && (
          <button
            onClick={() => onSelect(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Limpiar
          </button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => {
          const selected = s.id === selectedId;
          const dirCls = s.direction === "long" ? "text-success" : "text-destructive";
          return (
            <button
              key={s.id}
              onClick={() => onSelect(selected ? null : s.id)}
              className={`text-left rounded-md border p-3 transition ${
                selected ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono">
                <span className={`font-bold uppercase ${dirCls}`}>{s.direction}</span>
                <span className="text-muted-foreground">{s.poiKind === "ORDER_BLOCK" ? "OB" : "FVG"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] font-mono">
                <span className="rounded bg-muted px-1.5 py-0.5 text-foreground/80">{s.orderType}</span>
                <span className="text-muted-foreground">{s.status}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-mono">
                <span className="text-muted-foreground">Entry</span>
                <span className="text-right">{pxFmt(s.entry)}</span>
                <span className="text-muted-foreground">SL</span>
                <span className="text-right text-destructive">{pxFmt(s.sl)}</span>
                <span className="text-muted-foreground">TP1</span>
                <span className="text-right text-success">{pxFmt(s.tp1)}</span>
                <span className="text-muted-foreground">TP2</span>
                <span className="text-right text-success">{pxFmt(s.tp2)}</span>
                <span className="text-muted-foreground">RR</span>
                <span className="text-right">{s.rrToTp1.toFixed(2)} / {s.rrToTp2.toFixed(2)}</span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                TP1: {s.targets[0]?.reason ?? "—"} · TP2: {s.targets[1]?.reason ?? "—"} · TP3: {s.targets[2]?.reason ?? "—"}
              </div>
              {s.trigger && (
                <div className={`mt-1 text-[10px] font-mono ${s.trigger.satisfied ? "text-success" : "text-amber-400"}`}>
                  {s.trigger.satisfied ? "✓" : "⏳"} {s.trigger.description}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Score</span>
                <span className="font-mono text-primary">{s.scoreOut100}/100 · {s.grade}</span>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                canon {Math.round(s.score * 100)}% · ml {s.mlScore !== null ? Math.round(s.mlScore * 100) + "%" : "—"}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.confluences.map((c) => (
                  <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {CONFLUENCE_LABELS[c] ?? c}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-foreground/80 leading-snug">{s.rationale}</p>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

const DECISION_STYLE: Record<OperationalReport["decision"], string> = {
  BUY: "border-success/60 bg-success/10",
  SELL: "border-destructive/60 bg-destructive/10",
  WAIT: "border-amber-400/60 bg-amber-400/10",
  NO_TRADE: "border-muted bg-muted/30",
};
const DECISION_TEXT: Record<OperationalReport["decision"], string> = {
  BUY: "text-success",
  SELL: "text-destructive",
  WAIT: "text-amber-400",
  NO_TRADE: "text-muted-foreground",
};

function DecisionHeader({
  report,
  pxFmt,
}: {
  report: OperationalReport;
  pxFmt: (n: number) => string;
}) {
  const cls = DECISION_STYLE[report.decision];
  const txt = DECISION_TEXT[report.decision];
  const sig = report.primarySignal;
  const isMarket = sig?.orderType === "MARKET_BUY" || sig?.orderType === "MARKET_SELL";
  const isPending = sig && !isMarket && sig.orderType !== "NO_ORDER";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-2xl font-extrabold tracking-tight font-mono ${txt}`}>
          {report.decision === "BUY" ? "COMPRAR"
            : report.decision === "SELL" ? "VENDER"
            : report.decision === "WAIT" ? "ESPERAR" : "NO OPERAR"}
        </span>
        {sig && (report.decision === "BUY" || report.decision === "SELL") && (
          <span className={`rounded border px-2 py-0.5 text-[10px] font-mono ${txt}`}>
            {isMarket ? "MARKET (ejecutar ahora)" : isPending ? `ARMADO · ${sig.orderType.replace(/_/g, " ")}` : sig.orderType.replace(/_/g, " ")}
          </span>
        )}
        <span className="rounded border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
          {report.status}
        </span>
        <span className="rounded border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
          {report.template.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-2 text-sm text-foreground/90">{report.summary}</p>

      {(report.decision === "BUY" || report.decision === "SELL") && sig && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
          <div><span className="text-muted-foreground">Entry </span>{pxFmt(sig.entry)}</div>
          <div><span className="text-muted-foreground">SL </span><span className="text-destructive">{pxFmt(sig.sl)}</span></div>
          <div><span className="text-muted-foreground">TP1 </span><span className="text-success">{pxFmt(sig.tp1)}</span></div>
          <div><span className="text-muted-foreground">RR </span>{sig.rrToTp1.toFixed(2)}</div>
        </div>
      )}

      {report.decision === "WAIT" && (
        <div className="mt-2 space-y-1 text-xs">
          {report.missing.length > 0 && (
            <div><span className="text-muted-foreground">Falta: </span>{report.missing.join(" · ")}</div>
          )}
          {sig?.nextAction && (
            <div><span className="text-muted-foreground">Próxima acción: </span>{sig.nextAction}</div>
          )}
          {sig?.invalidation?.price != null && (
            <div><span className="text-muted-foreground">Invalidación: </span><span className="text-destructive">{pxFmt(sig.invalidation.price)}</span>{sig.invalidation.reason ? ` (${sig.invalidation.reason})` : ""}</div>
          )}
        </div>
      )}

      {report.decision === "NO_TRADE" && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">Blockers: </span>
          <span className="font-mono">{report.reasons.join(" · ") || "NO_VALID_SETUP"}</span>
        </div>
      )}

      <div className="mt-2 text-[10px] text-muted-foreground">
        Modelo legacy: {sig?.mlScore != null ? `${Math.round(sig.mlScore * 100)}% (diagnóstico)` : "—"}
      </div>
    </div>
  );
}