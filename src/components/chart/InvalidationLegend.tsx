import type { ElliottResultDTO } from "@/lib/detection/elliott/types";
import { Badge } from "@/components/ui/badge";

const STATUS_COLOR: Record<string, string> = {
  PASS: "text-success",
  FAIL: "text-destructive",
  PENDING: "text-muted-foreground",
};

export function InvalidationLegend({ elliott }: { elliott: ElliottResultDTO | null }) {
  if (!elliott) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Rules</div>
        <Badge variant="outline" className="font-mono">
          conf {elliott.confidence}
        </Badge>
      </div>
      <ul className="space-y-1 text-xs font-mono">
        {elliott.rules.map((r) => (
          <li key={r.code} className="flex items-start justify-between gap-2">
            <span className="text-foreground/80">{r.code}</span>
            <span className={STATUS_COLOR[r.status] ?? ""}>
              {r.status}
            </span>
          </li>
        ))}
      </ul>
      {elliott.invalidationLevel !== null && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <div className="text-destructive font-mono">Invalidation @ {elliott.invalidationLevel.toFixed(5)}</div>
          <div className="text-muted-foreground mt-1">
            Break of this level invalidates the current {elliott.pattern} count.
          </div>
        </div>
      )}
    </div>
  );
}