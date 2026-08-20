/**
 * SONIC BETA card — DISPLAY / OBSERVATION ONLY.
 *
 * Reads the existing PRE_RAID_APPROACH_V1 observations and renders them with a
 * transparent label mapping (see `beta-display.ts`). It never influences the
 * DecisionBanner, setup gating/scoring, Elliott/ICT, alerts or the underlying
 * score/feature/outcome definitions.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLatestPreRaid, type PreRaidLatestResult } from "@/lib/preRaid.functions";
import {
  mapSonicBeta,
  SONIC_COMPONENT_LABELS_ES,
  SONIC_COMPONENT_ORDER,
  type SonicBetaSide,
} from "@/lib/ml/smc/beta-display";
import type { PreRaidFeatureName } from "@/lib/ml/smc/pre-raid";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";

/** Observations older than this are not treated as a live signal. */
const FRESH_WINDOW_SECONDS = 30 * 60;

type ComponentRow = { name: string; pass?: boolean };

function passMap(components: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (Array.isArray(components)) {
    for (const c of components as ComponentRow[]) {
      if (c && typeof c.name === "string") out[c.name] = c.pass === true;
    }
  }
  return out;
}

function headlineTone(headline: string): string {
  if (headline === "SEÑAL BETA LONG") return "text-success";
  if (headline === "SEÑAL BETA SHORT") return "text-destructive";
  if (headline === "VIGILAR") return "text-amber-400";
  if (headline.startsWith("CONFLICTO")) return "text-amber-400";
  return "text-muted-foreground";
}

export function SonicBetaPanel({ symbol }: { symbol: string }) {
  const fetchLatest = useServerFn(getLatestPreRaid);
  const [data, setData] = useState<PreRaidLatestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (symbol !== "XAU/USD") {
      setData(null);
      return;
    }
    let alive = true;
    const run = async () => {
      try {
        const res = await fetchLatest({ data: { symbol } });
        if (alive) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void run();
    const id = setInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, fetchLatest]);

  if (symbol !== "XAU/USD") return null;

  const asOf = data?.asOf ?? Math.floor(Date.now() / 1000);
  const fresh = (iso: string | undefined) =>
    iso != null && asOf - Math.floor(new Date(iso).getTime() / 1000) <= FRESH_WINDOW_SECONDS;

  const longRow = data?.long ?? null;
  const shortRow = data?.short ?? null;
  const longFresh = fresh(longRow?.candidate_at);
  const shortFresh = fresh(shortRow?.candidate_at);
  const windowActive = data?.window.active === true;

  const display = mapSonicBeta({
    available: windowActive && (longFresh || shortFresh),
    longCount: longFresh ? longRow?.component_count : null,
    shortCount: shortFresh ? shortRow?.component_count : null,
  });

  const best =
    display.long && display.short
      ? display.long.componentCount >= display.short.componentCount
        ? { side: display.long, row: longRow }
        : { side: display.short, row: shortRow }
      : display.long
        ? { side: display.long, row: longRow }
        : display.short
          ? { side: display.short, row: shortRow }
          : null;

  const passes = passMap(best?.row?.components);

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest">SONIC BETA</span>
          <Badge
            variant="outline"
            className="font-mono text-[10px] text-amber-400 border-amber-400/60"
          >
            BETA
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            PRE_RAID_APPROACH_V1
          </Badge>
        </div>
        <span className={`font-mono text-sm font-bold ${headlineTone(display.headline)}`}>
          {display.headline}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">{display.disclaimer}</p>

      {error && <div className="text-[11px] text-destructive">Lectura diagnóstica: {error}</div>}

      <div className="grid grid-cols-2 gap-2">
        <SideBox side={display.long} label="LONG" />
        <SideBox side={display.short} label="SHORT" />
      </div>

      {best && (
        <ul className="space-y-0.5 text-[11px]">
          {SONIC_COMPONENT_ORDER.map((name: PreRaidFeatureName) => {
            const ok = passes[name] === true;
            return (
              <li key={name} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{SONIC_COMPONENT_LABELS_ES[name]}</span>
                {ok ? (
                  <span className="flex items-center gap-1 text-success">
                    <Check className="h-3 w-3" /> cumple
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <X className="h-3 w-3" /> no cumple
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!windowActive && (
        <div className="text-[11px] text-muted-foreground">
          Ventana validada: {data?.window.window ?? "06:00–07:59 Europe/London"}
          {data?.window ? ` · London ${data.window.londonLocal}` : ""}. Fuera de la ventana no se
          calcula ninguna señal.
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">
        Solo observación: no genera órdenes ni alertas y no altera COMPRAR/VENDER/ESPERAR.
      </div>
    </div>
  );
}

function SideBox({ side, label }: { side: SonicBetaSide | null; label: string }) {
  const tone = label === "LONG" ? "text-success" : "text-destructive";
  return (
    <div className="rounded border border-border/50 p-2">
      <div className={`text-[11px] uppercase tracking-wide ${tone}`}>{label}</div>
      <div className="mt-1 font-mono text-sm">{side ? side.componentsLabel : "—"}</div>
      <div className="font-mono text-[11px] text-muted-foreground">
        {side ? side.similarityLabel : "sin observación"}
      </div>
      {side && <div className="mt-0.5 font-mono text-[10px]">{side.state}</div>}
    </div>
  );
}
