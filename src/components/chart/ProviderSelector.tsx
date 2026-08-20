/**
 * OHLC data-source selector. `Auto` keeps the corrected cascade; any explicit
 * choice pins that single provider for the chart AND for every engine, since
 * they all consume the same closed-candle snapshot.
 */
import {
  PROVIDER_LABELS,
  PROVIDER_NOTES,
  PROVIDER_PREFERENCES,
  providerSupports,
  type ProviderPreference,
} from "@/lib/marketData/provider-choice";

export function ProviderSelector({
  value,
  onChange,
  symbol,
  interval,
}: {
  value: ProviderPreference;
  onChange: (v: ProviderPreference) => void;
  symbol: string;
  interval: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Fuente</span>
      <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
        {PROVIDER_PREFERENCES.map((p) => {
          const support = providerSupports(p, symbol, interval);
          const active = value === p;
          return (
            <button
              key={p}
              type="button"
              disabled={!support.ok}
              onClick={() => support.ok && onChange(p)}
              title={support.ok ? PROVIDER_NOTES[p] : support.reason}
              className={`px-2 py-1.5 font-mono ${
                active
                  ? "bg-primary text-primary-foreground"
                  : support.ok
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/40 cursor-not-allowed line-through"
              }`}
            >
              {PROVIDER_LABELS[p].split(" / ")[0]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
