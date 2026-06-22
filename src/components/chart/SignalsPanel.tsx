import type { TradeSignal } from "@/lib/detection/setup/types";

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
  selectedId,
  onSelect,
  pxFmt,
}: {
  signals: TradeSignal[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  pxFmt: (n: number) => string;
}) {
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Señales</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Sin confluencia operativa en las velas recientes. El motor seguirá observando.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Señales ({signals.length})
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
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Score</span>
                <span className="font-mono text-primary">{Math.round(s.finalScore * 100)}%</span>
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
  );
}