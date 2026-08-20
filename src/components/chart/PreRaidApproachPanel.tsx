/**
 * PRE_RAID_APPROACH_V1 diagnostic panel.
 *
 * Read-only. Never influences DecisionBanner, setup score, signals or alerts.
 * The score is SETUP-LIKENESS, never a win probability.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getLatestPreRaid,
  type PreRaidLatestResult,
  type PreRaidLatestRow,
} from "@/lib/preRaid.functions";
import { Badge } from "@/components/ui/badge";

type Outcome = {
  horizon_minutes?: number;
  directional_close_return_atr?: number;
  mfe_atr?: number;
  mae_atr?: number;
  displacement_1atr?: boolean;
};

const HORIZON_KEYS = ["outcome_1m", "outcome_3m", "outcome_5m", "outcome_15m"] as const;

export function PreRaidApproachPanel({
  symbol,
  compact = false,
}: {
  symbol: string;
  compact?: boolean;
}) {
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

  const long = data?.long ?? null;
  const short = data?.short ?? null;
  const best = !long ? short : !short ? long : long.setup_score >= short.setup_score ? long : short;

  return (
    <div className="rounded border border-border/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          SONIC-likeness
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          PRE_RAID_APPROACH_V1
        </Badge>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Diagnóstico: mide qué tanto el minuto se parece a la selección de setup SONIC (pre-raid
        approach). <span className="text-foreground">No es probabilidad de acierto</span> y no
        interviene en decisiones, señales ni alertas.
      </p>

      {error && <div className="text-[11px] text-destructive">diagnostic read error: {error}</div>}

      {!error && !long && !short && (
        <div className="text-[11px] text-muted-foreground">
          Sin observaciones. Ventana validada: {data?.window.window ?? "06:00–07:59 Europe/London"}
          {data?.window
            ? ` · London ${data.window.londonLocal} · ${data.window.active ? "activa" : "inactiva"}`
            : ""}
          . Fuera de la ventana no se calcula ningún score.
        </div>
      )}

      {(long || short) && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["long", "short"] as const).map((dir) => {
              const row = dir === "long" ? long : short;
              const isBest = best != null && row != null && row.id === best.id;
              return (
                <div
                  key={dir}
                  className={`rounded border p-2 ${isBest ? "border-primary/70" : "border-border/50"}`}
                >
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                    <span className={dir === "long" ? "text-success" : "text-destructive"}>
                      {dir}
                    </span>
                    {isBest && <span className="text-primary text-[10px]">mayor likeness</span>}
                  </div>
                  <div className="mt-1 font-mono text-sm">
                    {row
                      ? `${row.component_count}/5 · ${Math.round(row.setup_score * 100)}% likeness`
                      : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {best && !compact && (
            <div className="space-y-0.5 font-mono text-[11px]">
              <Line label="candidate_at" value={new Date(best.candidate_at).toUTCString()} />
              <Line label="dist_liquidity" value={num(best.dist_liquidity, 3, " ATR")} />
              <Line label="approach_velocity" value={num(best.approach_velocity, 4, " ATR/m")} />
              <Line label="micro_pullback" value={num(best.micro_pullback, 3)} />
              <Line label="asia_position" value={num(best.asia_position, 3)} />
              <Line label="raid_state" value={best.raid_state ?? "—"} />
              <Line label="raid_norm" value={num(best.minutes_since_relevant_raid_norm, 3)} />
              <Line label="atr_m5" value={num(best.atr_m5, 3)} />
              <Line label="provider" value={best.provider ?? "—"} />
            </div>
          )}

          {best && <Outcomes row={best} />}
        </>
      )}
    </div>
  );
}

function Outcomes({ row }: { row: PreRaidLatestRow }) {
  const rows = HORIZON_KEYS.map((k) => row[k] as Outcome | null).filter(
    (o): o is Outcome => o != null && typeof o === "object",
  );
  if (!rows.length) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Resultados +1/+3/+5/+15m aún no maduros.
      </div>
    );
  }
  return (
    <table className="w-full font-mono text-[11px]">
      <thead className="text-muted-foreground">
        <tr>
          <th className="text-left font-normal">h</th>
          <th className="text-right font-normal">close ATR</th>
          <th className="text-right font-normal">MFE</th>
          <th className="text-right font-normal">MAE</th>
          <th className="text-right font-normal">1 ATR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.horizon_minutes}>
            <td className="text-left">+{o.horizon_minutes}m</td>
            <td className="text-right">{num(o.directional_close_return_atr, 2)}</td>
            <td className="text-right">{num(o.mfe_atr, 2)}</td>
            <td className="text-right">{num(o.mae_atr, 2)}</td>
            <td
              className={`text-right ${o.displacement_1atr ? "text-success" : "text-muted-foreground"}`}
            >
              {o.displacement_1atr ? "yes" : "no"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function num(v: number | null | undefined, digits: number, suffix = ""): string {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}${suffix}`;
}
