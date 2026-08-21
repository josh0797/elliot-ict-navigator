/**
 * SONIC AUDIT — read-only audit of the PRE_RAID_APPROACH_V1 research capture.
 *
 * Displays exactly what is stored in `pre_raid_observations`: which minutes were
 * captured, the frozen pre-entry features, the component checks and the
 * after-the-fact outcomes. Nothing on this page feeds the decision engine,
 * alerts, Elliott/ICT or scoring.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPreRaidAudit, type PreRaidAuditResult } from "@/lib/preRaid.functions";
import { SONIC_COMPONENT_LABELS_ES, SONIC_BETA_DISCLAIMER } from "@/lib/ml/smc/beta-display";
import type { PreRaidFeatureName } from "@/lib/ml/smc/pre-raid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, RefreshCw, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sonic-audit")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "SONIC Audit — datos capturados por PRE_RAID_APPROACH_V1" },
      {
        name: "description",
        content:
          "Auditoría de solo lectura de las observaciones SONIC (PRE_RAID_APPROACH_V1): minutos capturados, variables congeladas, componentes y resultados posteriores.",
      },
      { property: "og:title", content: "SONIC Audit — Elliott × ICT Pro Terminal" },
      {
        property: "og:description",
        content:
          "Qué datos está recopilando SONIC en la ventana de Londres 06:00–07:59, con métricas de cobertura y desplazamiento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SonicAuditPage,
});

const DAY_OPTIONS = [7, 30, 90, 365] as const;
const DIRECTIONS = ["all", "long", "short"] as const;

function fmt(n: number | null | undefined, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function pct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

function iso(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ") + "Z";
}

type Row = PreRaidAuditResult["rows"][number];

function outcomeCell(row: Row, horizon: 1 | 3 | 5 | 15) {
  const raw = (
    horizon === 1
      ? row.outcome_1m
      : horizon === 3
        ? row.outcome_3m
        : horizon === 5
          ? row.outcome_5m
          : row.outcome_15m
  ) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return <span className="text-muted-foreground">pend.</span>;
  const disp = raw["displacement_1atr"] === true;
  const mfe = raw["mfe_atr"];
  return (
    <span className={disp ? "text-success" : "text-muted-foreground"}>
      {disp ? "1ATR" : "—"} · {typeof mfe === "number" ? mfe.toFixed(2) : "?"}
    </span>
  );
}

function toCsv(rows: Row[], featureNames: readonly string[]): string {
  const header = [
    "candidate_at",
    "direction",
    "reference_price",
    "atr_m5",
    "component_count",
    "setup_score",
    "raid_state",
    "provider",
    "source_last_closed_at",
    ...featureNames,
    "disp_1m",
    "disp_3m",
    "disp_5m",
    "disp_15m",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const features = (r.features ?? {}) as Record<string, unknown>;
    const disp = (o: unknown) =>
      o && typeof o === "object" ? String((o as Record<string, unknown>)["displacement_1atr"]) : "";
    lines.push(
      [
        r.candidate_at,
        r.direction,
        r.reference_price,
        r.atr_m5,
        r.component_count,
        r.setup_score,
        r.raid_state ?? "",
        r.provider ?? "",
        r.source_last_closed_at ?? "",
        ...featureNames.map((f) => {
          const v = features[f];
          return typeof v === "number" ? v : "";
        }),
        disp(r.outcome_1m),
        disp(r.outcome_3m),
        disp(r.outcome_5m),
        disp(r.outcome_15m),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function SonicAuditPage() {
  const fetchAudit = useServerFn(getPreRaidAudit);
  const exportCsv = useServerFn(exportPreRaidAuditCsv);
  const [days, setDays] = useState<number>(30);
  const [direction, setDirection] = useState<"all" | "long" | "short">("all");
  const [data, setData] = useState<PreRaidAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAudit({ data: { symbol: "XAU/USD", days, direction, limit: 500 } });
      setData(res);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchAudit, days, direction]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  const download = useMemo(
    () => () => {
      if (!data) return;
      const blob = new Blob([toCsv(rows, data.featureNames)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sonic-audit-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [data, rows, days],
  );

  /**
   * FULL export — every row matching the active filters, paginated server-side,
   * with all audit columns (JSON blobs included) RFC4180-escaped.
   */
  const downloadFull = useCallback(async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await exportCsv({ data: { symbol: "XAU/USD", days, direction } });
      const blob = new Blob(["\uFEFF", res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(
        `${res.rowCount} filas exportadas${res.truncated ? " (recortado por límite de seguridad)" : ""}`,
      );
    } catch (e) {
      setExportNote(`Error al exportar: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [exportCsv, days, direction]);


  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
            </Link>
          </Button>
          <h1 className="font-mono text-lg font-bold tracking-tight">SONIC Audit</h1>
          <Badge variant="outline" className="font-mono text-[10px] text-primary border-primary/50">
            BETA · solo observación
          </Badge>
          {data && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {data.detectorVersion}
            </Badge>
          )}
          {data && (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] ${data.window.active ? "text-success border-success/50" : "text-muted-foreground"}`}
              title={data.window.window}
            >
              Londres {data.window.londonLocal} · {data.window.active ? "ventana ON" : "fuera"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1.5 font-mono ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`px-2.5 py-1.5 font-mono ${direction === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {d === "all" ? "Todo" : d === "long" ? "Long" : "Short"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={download} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">{SONIC_BETA_DISCLAIMER}</p>

      {error && (
        <div className="rounded border border-destructive/60 bg-destructive/10 p-3 text-xs font-mono text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Observaciones" value={summary ? String(summary.total) : "—"} />
        <Metric
          label="Long / Short"
          value={summary ? `${summary.long} / ${summary.short}` : "—"}
          hint="Candidatos capturados por dirección"
        />
        <Metric
          label="Días con captura"
          value={summary ? String(summary.captureDays) : "—"}
          hint="Días distintos con al menos una observación"
        />
        <Metric
          label="Resultados / pendientes"
          value={summary ? `${summary.withOutcomes} / ${summary.pending}` : "—"}
          hint="Filas con al menos un horizonte resuelto"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
              Componentes cumplidos (0–5)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs font-mono">
            {(summary?.componentHistogram ?? []).map((count, i) => {
              const total = summary?.total ?? 0;
              const width = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 text-muted-foreground">{i}</span>
                  <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${width}%` }} />
                  </div>
                  <span className="w-10 text-right">{count}</span>
                </div>
              );
            })}
            <div className="pt-1 text-muted-foreground">
              score medio: {fmt(summary?.avgSetupScore, 2)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
              Desplazamiento posterior (≥1 ATR)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs font-mono">
            {(summary?.horizons ?? []).map((h) => (
              <div key={h.horizon} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{h.horizon}m</span>
                <span>
                  {h.displacement}/{h.resolved} · {pct(h.displacementRate)} · MFE {fmt(h.avgMfeAtr)}{" "}
                  · MAE {fmt(h.avgMaeAtr)}
                </span>
              </div>
            ))}
            <div className="pt-1 text-muted-foreground">
              Medido a posteriori · nunca entra en las variables congeladas.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
              Medianas observadas · fuentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs font-mono">
            {Object.entries(summary?.featureMedians ?? {}).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-2">
                <span className="text-muted-foreground truncate">
                  {SONIC_COMPONENT_LABELS_ES[name as PreRaidFeatureName] ?? name}
                </span>
                <span>{fmt(value, 3)}</span>
              </div>
            ))}
            <div className="pt-1 text-muted-foreground">
              proveedores:{" "}
              {Object.entries(summary?.providers ?? {})
                .map(([p, c]) => `${p}×${c}`)
                .join(", ") || "—"}
            </div>
            <div className="text-muted-foreground">
              raid:{" "}
              {Object.entries(summary?.raidStates ?? {})
                .map(([p, c]) => `${p}×${c}`)
                .join(", ") || "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
            Observaciones capturadas ({rows.length}) · {iso(summary?.firstCandidateAt)} →{" "}
            {iso(summary?.lastCandidateAt)}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading && !rows.length ? (
            <div className="p-4 text-xs font-mono text-muted-foreground">Cargando auditoría…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              Sin observaciones en el rango. SONIC solo captura de lunes a viernes entre 06:00 y
              07:59 (Europe/London) sobre XAU/USD.
            </div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead className="text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="px-2 py-1.5 text-left">Minuto (UTC)</th>
                  <th className="px-2 py-1.5 text-left">Dir</th>
                  <th className="px-2 py-1.5 text-right">Ref</th>
                  <th className="px-2 py-1.5 text-right">ATR M5</th>
                  <th className="px-2 py-1.5 text-right">Comp</th>
                  <th className="px-2 py-1.5 text-left">Raid</th>
                  <th className="px-2 py-1.5 text-left">1m</th>
                  <th className="px-2 py-1.5 text-left">5m</th>
                  <th className="px-2 py-1.5 text-left">15m</th>
                  <th className="px-2 py-1.5 text-left">Fuente</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-border/40 hover:bg-muted/30">
                      <td className="px-2 py-1.5">{iso(r.candidate_at)}</td>
                      <td
                        className={`px-2 py-1.5 ${r.direction === "long" ? "text-success" : "text-destructive"}`}
                      >
                        {r.direction.toUpperCase()}
                      </td>
                      <td className="px-2 py-1.5 text-right">{fmt(r.reference_price)}</td>
                      <td className="px-2 py-1.5 text-right">{fmt(r.atr_m5, 3)}</td>
                      <td className="px-2 py-1.5 text-right">{r.component_count}/5</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.raid_state ?? "—"}</td>
                      <td className="px-2 py-1.5">{outcomeCell(r, 1)}</td>
                      <td className="px-2 py-1.5">{outcomeCell(r, 5)}</td>
                      <td className="px-2 py-1.5">{outcomeCell(r, 15)}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.provider ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => setOpenId(openId === r.id ? null : r.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Ver detalle"
                        >
                          <ChevronRight
                            className={`h-3.5 w-3.5 transition-transform ${openId === r.id ? "rotate-90" : ""}`}
                          />
                        </button>
                      </td>
                    </tr>
                    {openId === r.id && (
                      <tr className="bg-muted/20">
                        <td colSpan={11} className="px-3 py-2">
                          <div className="grid gap-3 md:grid-cols-2">
                            <pre className="overflow-x-auto text-[10px] leading-relaxed">
                              {JSON.stringify(
                                {
                                  features: r.features,
                                  components: r.components,
                                  london_context: r.london_context,
                                },
                                null,
                                2,
                              )}
                            </pre>
                            <pre className="overflow-x-auto text-[10px] leading-relaxed">
                              {JSON.stringify(
                                {
                                  source_last_closed_at: r.source_last_closed_at,
                                  outcomes_updated_at: r.outcomes_updated_at,
                                  outcome_1m: r.outcome_1m,
                                  outcome_3m: r.outcome_3m,
                                  outcome_5m: r.outcome_5m,
                                  outcome_15m: r.outcome_15m,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="font-mono text-lg">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
