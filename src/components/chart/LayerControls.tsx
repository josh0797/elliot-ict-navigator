import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { LayerToggles } from "./TradingChart";

const OPTIONS: { key: keyof LayerToggles; label: string }[] = [
  { key: "elliottLines",      label: "Elliott lines" },
  { key: "elliottLabels",     label: "Elliott labels" },
  { key: "alternativeCount",  label: "Alternative count" },
  { key: "invalidation",      label: "Invalidation" },
  { key: "fibonacciElliott",  label: "Fibonacci Elliott" },
];

export function LayerControls({
  layers,
  onChange,
}: {
  layers: LayerToggles;
  onChange: (next: LayerToggles) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Layers</div>
      <div className="space-y-2">
        {OPTIONS.map((o) => (
          <div key={o.key} className="flex items-center justify-between">
            <Label htmlFor={`layer-${o.key}`} className="text-sm text-foreground/90">{o.label}</Label>
            <Switch
              id={`layer-${o.key}`}
              checked={layers[o.key]}
              onCheckedChange={(v) => onChange({ ...layers, [o.key]: v })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
