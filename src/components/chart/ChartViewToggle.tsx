import type { ChartViewMode } from "./TradingChart";
import { Eye, Activity } from "lucide-react";

export function ChartViewToggle({
  mode,
  onChange,
}: {
  mode: ChartViewMode;
  onChange: (m: ChartViewMode) => void;
}) {
  return (
    <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
      <button
        onClick={() => onChange("operational")}
        className={`px-3 py-1.5 font-mono flex items-center gap-1.5 ${
          mode === "operational" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
        title="Solo el setup activo (entry, SL, TPs, trigger, invalidación)"
      >
        <Eye className="h-3.5 w-3.5" /> Operational
      </button>
      <button
        onClick={() => onChange("diagnostic")}
        className={`px-3 py-1.5 font-mono flex items-center gap-1.5 ${
          mode === "diagnostic" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
        title="Todas las capas Elliott / ICT"
      >
        <Activity className="h-3.5 w-3.5" /> Diagnostic
      </button>
    </div>
  );
}
