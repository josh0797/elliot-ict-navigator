import { useNavigate } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { groupSymbols } from "@/lib/symbols";

/**
 * Grouped instrument picker (Forex / Metals / Crypto).
 * Selecting an item navigates to the chart route for the new symbol, preserving the timeframe.
 */
export function SymbolPicker({
  symbol,
  tf,
  bars,
}: {
  symbol: string;
  tf: string;
  bars: number;
}) {
  const navigate = useNavigate();
  const groups = groupSymbols();

  return (
    <Select
      value={symbol}
      onValueChange={(next) =>
        navigate({
          to: "/chart/$symbol",
          params: { symbol: next },
          search: { tf, bars },
        })
      }
    >
      <SelectTrigger className="w-[220px] font-mono text-xs h-8">
        <SelectValue placeholder="Select instrument" />
      </SelectTrigger>
      <SelectContent className="max-h-[420px]">
        {(["Forex", "Metals", "Crypto"] as const).map((g, i) => (
          <div key={g}>
            {i > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {g}
              </SelectLabel>
              {groups[g].map((s) => (
                <SelectItem key={s.symbol} value={s.symbol} className="font-mono text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}