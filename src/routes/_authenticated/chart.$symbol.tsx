import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeSymbol } from "@/lib/elliott.functions";
import { detectSetupsMTF } from "@/lib/setups.functions";
import { fetchOhlcv } from "@/lib/marketData.functions";
import type { Candle } from "@/lib/twelvedata.functions";
import { detectSetup } from "@/lib/detection/engine";
import type { TradeSetup } from "@/lib/detection/types";
import type { ElliottResultDTO } from "@/lib/detection/elliott/types";
import type { IctContext } from "@/lib/detection/ict/types";
import type { TradeSignal } from "@/lib/detection/setup/types";
import {
  TradingChart,
  type LayerToggles,
  type PivotTooltip,
  type ChartViewMode,
} from "@/components/chart/TradingChart";
import { LayerControls } from "@/components/chart/LayerControls";
import { ChartViewToggle } from "@/components/chart/ChartViewToggle";
import { InvalidationLegend } from "@/components/chart/InvalidationLegend";
import { SymbolPicker } from "@/components/chart/SymbolPicker";
import { SignalsPanel } from "@/components/chart/SignalsPanel";
import { ScenariosPanel } from "@/components/chart/ScenariosPanel";
import { PreRaidApproachPanel } from "@/components/chart/PreRaidApproachPanel";
import { DecisionBanner } from "@/components/chart/DecisionBanner";
import type { OperationalReport } from "@/lib/detection/decision/types";
import { HISTORY_PRESETS } from "@/lib/symbols";
import { cached, chartKey, Timings, invalidate } from "@/lib/chart/cache";
import {
  composeSnapshot,
  SnapshotController,
  snapshotKey,
  type AnalysisSnapshot,
} from "@/lib/chart/snapshot";
import {
  clearDesyncGuard,
  isServerFnDesyncError,
  recoverFromServerFnDesync,
} from "@/lib/chart/server-fn-recovery";
import { APP_BUILD_ID } from "@/lib/build-id";
import { contextTimeframeFor } from "@/lib/detection/mtf";
import type { Freshness } from "@/lib/marketData/freshness";
import type { ElliottDegree } from "@/lib/detection/elliott/degrees";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";

const Search = z.object({
  tf: z.string().default("1h"),
  bars: z.coerce.number().int().min(50).max(5000).default(500),
});

export const Route = createFileRoute("/_authenticated/chart/$symbol")({
  validateSearch: (s) => Search.parse(s),
  head: ({ params }) => ({
    meta: [{ title: `${decodeSymbolParam(params.symbol)} — Elliott × ICT Pro` }],
  }),
  component: ChartPage,
});

/**
 * Decode a route symbol param defensively. TanStack Router already decodes
 * params once, but legacy/shared links may carry a double-encoded form
 * (e.g. `XAU%252FUSD`). Try one extra safe decode pass.
 */
function decodeSymbolParam(raw: string): string {
  let value = raw;
  // If a stray %25 still encodes a percent, decode one more time.
  if (/%25[0-9A-Fa-f]{2}/.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* ignore */
    }
  }
  return value;
}

/**
 * Retry genuinely transient transport failures only.
 *
 * "Server function info not found" is NOT transient: the loaded client bundle
 * and the deployed server bundle come from different builds, so retrying the
 * same hashed id can only fail again. It is rethrown immediately and handled by
 * the single-reload recovery path.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (isServerFnDesyncError(err)) throw err;
      const msg = String((err as Error)?.message ?? "");
      const transient = /failed to fetch|networkerror|load failed|502|503|504/i.test(msg);
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw last;
}

const OK_FRESHNESS: Freshness = {
  status: "OK",
  ageSeconds: 0,
  stale: false,
  marketOpen: true,
  toleranceSeconds: 0,
};

/** Human age of the last closed candle. */
function formatAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const DEFAULT_LAYERS: LayerToggles = {
  primaryCount: true,
  internalWaves: true,
  elliottLines: true,
  elliottLabels: true,
  alternativeCount: true,
  invalidation: true,
  fibonacciElliott: false,
  liquidity: true,
  sweeps: true,
};

function loadLayers(): LayerToggles {
  if (typeof window === "undefined") return DEFAULT_LAYERS;
  try {
    const raw = window.localStorage.getItem("chart-layers");
    if (!raw) return DEFAULT_LAYERS;
    return { ...DEFAULT_LAYERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LAYERS;
  }
}

function ChartPage() {
  const { symbol } = Route.useParams();
  const { tf, bars } = Route.useSearch();
  const decoded = decodeSymbolParam(symbol);
  const fetch = useServerFn(fetchOhlcv);
  const analyze = useServerFn(analyzeSymbol);
  const findSetups = useServerFn(detectSetupsMTF);

  // ONE atomic snapshot drives every panel: candles, macro count, local count,
  // ICT and decision always belong to the same timeframe and the same `asOf`.
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<PivotTooltip | null>(null);
  const [pending, setPending] = useState<{ tf: string; bars: number } | null>({ tf, bars });
  const [phase, setPhase] = useState<string | null>("Loading market data...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const [horizon, setHorizon] = useState<{
    candles: number;
    pivots: number;
    pivotsUsed: number;
  } | null>(null);
  const [degreePref, setDegreePref] = useState<"auto" | ElliottDegree>("auto");
  const [interval, setInterval] = useState(tf);
  const [outputsize, setOutputsize] = useState(bars);
  const [layers, setLayers] = useState<LayerToggles>(() => loadLayers());
  const [viewMode, setViewMode] = useState<ChartViewMode>("operational");
  const ctlRef = useRef<SnapshotController>(new SnapshotController());
  const prevSymbolRef = useRef(decoded);

  const loading = pending !== null;
  const candles = snapshot?.candles ?? [];
  const elliott = snapshot?.localElliottCount ?? null;
  const macro = snapshot?.macroElliottCount ?? null;
  const ict = snapshot?.ictAnalysis ?? null;
  const signals = snapshot?.signals ?? [];
  const decision = snapshot?.decision ?? null;
  const provider = snapshot?.provider ?? null;
  /** Timeframe actually rendered — read from the snapshot, never from the selector. */
  const shownTf = snapshot?.executionTimeframe ?? null;
  const contextTf = contextTimeframeFor(interval);
  const stale = snapshot?.freshness.stale ?? false;
  /** Snapshot belongs to another timeframe/bars → its drawing is dimmed. */
  const outdated = snapshot != null && (shownTf !== interval || snapshot.bars !== outputsize);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chart-layers", JSON.stringify(layers));
  }, [layers]);

  /**
   * Atomic pipeline. Every stage writes into local variables; the snapshot is
   * only published while its `requestId` is still the active epoch, so a late
   * 4h answer can never overwrite a current 1h view, and candles are never
   * paired with counts from another timeframe.
   */
  async function load(opts: { force?: boolean } = {}) {
    const ctl = ctlRef.current;
    const { requestId } = ctl.begin();
    const alive = () => ctl.isCurrent(requestId);
    const sym = decoded;
    const ivl = interval;
    const barsReq = outputsize;
    const t = new Timings();
    if (opts.force) invalidate(chartKey(["ohlc", sym, ivl]));
    setPending({ tf: ivl, bars: barsReq });
    setErrorMsg(null);
    setPhase(`Cargando ${ivl}…`);

    try {
      // ── Stage A: OHLC (closed candles, freshness-validated cascade) ───────
      const full = await t.measureAsync("apiFetchMs", () =>
        cached(chartKey(["ohlc", sym, ivl, barsReq]), () =>
          withRetry(() => fetch({ data: { symbol: sym, interval: ivl, outputsize: barsReq } })),
        ),
      );
      if (!alive()) return;
      if (!full.candles.length) {
        setSnapshot(null);
        setErrorMsg(full.error ?? "No market data returned by any provider");
        setPhase(null);
        return;
      }

      const asOf = full.asOf ?? Math.floor(Date.now() / 1000);
      const freshness = full.meta?.freshness ?? OK_FRESHNESS;
      const base = {
        symbol: sym,
        executionTimeframe: ivl,
        bars: barsReq,
        provider: full.provider,
        asOf,
        freshness,
        candles: full.candles,
        buildId: APP_BUILD_ID,
        livePrice: full.livePrice ?? null,
      };
      // Candles-only publish: coherent by construction (counts explicitly null,
      // UI labels it as loading) and already tagged with the new timeframe.
      ctl.publish(requestId, composeSnapshot({ ...base, partial: true }), setSnapshot);
      t.mark("firstPaintMs");

      if (freshness.stale || full.status === "DATA_STALE") {
        // DATA_STALE: no new count, no new signal.
        setErrorMsg(
          `DATA_STALE — ${full.provider} @ ${full.meta?.lastCandleIso ?? "?"}: análisis bloqueado`,
        );
        setPhase(null);
        setMetrics(t.snapshot());
        return;
      }

      // ── Stage B: Elliott (macro context + local execution) + ICT ──────────
      setPhase(`Calculando Elliott ${ivl}…`);
      const lastTime = full.candles[full.candles.length - 1]?.time ?? 0;
      const ana = await t.measureAsync("elliottMs", () =>
        cached(chartKey(["ana", sym, ivl, barsReq, degreePref, lastTime, asOf]), () =>
          withRetry(() =>
            analyze({
              data: {
                symbol: sym,
                interval: ivl,
                outputsize: barsReq,
                degree: degreePref === "auto" ? undefined : degreePref,
                candles: full.candles,
                includeMacro: true,
                asOf,
                dataStale: false,
              },
            }),
          ),
        ),
      );
      if (!alive()) return;

      // ── Stage C: setups + operational decision ────────────────────────────
      setPhase("Scanning setups...");
      const sigs = await t.measureAsync("setupsMs", () =>
        cached(chartKey(["setups", sym, ivl, barsReq, lastTime, asOf]), () =>
          withRetry(() =>
            // Exact same OHLC snapshot the chart is rendering.
            findSetups({
              data: {
                symbol: sym,
                interval: ivl,
                outputsize: barsReq,
                topN: 3,
                candles: full.candles,
                dataStale: false,
              },
            }),
          ),
        ),
      );
      if (!alive()) return;

      // ── Atomic publish ────────────────────────────────────────────────────
      const next = composeSnapshot({
        ...base,
        localElliottCount: ana.elliott,
        macroElliottCount: ana.macro,
        macroScenarioId: ana.macroScenarioId ?? null,
        ictAnalysis: ana.ict,
        decision: sigs.decision,
        signals: sigs.signals,
        partial: false,
      });
      const published = ctl.publish(requestId, next, (value) => {
        setSnapshot(value);
        setHorizon(ana.horizon ?? null);
        setSelectedSignalId((prev) =>
          prev && value.signals.some((s) => s.id === prev) ? prev : (value.signals[0]?.id ?? null),
        );
      });
      if (!published) return;
      setPhase(null);
      setMetrics(t.snapshot());
      if (typeof window !== "undefined") clearDesyncGuard(window.sessionStorage);
    } catch (err) {
      if (alive()) {
        console.error("[chart] load failed", err);
        if (isServerFnDesyncError(err) && typeof window !== "undefined") {
          const outcome = recoverFromServerFnDesync({
            storage: window.sessionStorage,
            reload: () => window.location.reload(),
            buildId: APP_BUILD_ID,
          });
          setErrorMsg(
            outcome.action === "blocked" ? outcome.message : "Actualizando la aplicación…",
          );
        } else {
          setErrorMsg((err as Error).message || "Failed to load market data");
        }
        // Never keep a previous timeframe's result under the new label.
        setSnapshot(null);
        setPhase(null);
      }
    } finally {
      if (alive()) setPending(null);
    }
  }

  useEffect(() => {
    // Any switch invalidates in-flight work; a symbol switch also wipes state.
    ctlRef.current.invalidate();
    if (prevSymbolRef.current !== decoded) {
      prevSymbolRef.current = decoded;
      setSnapshot(null);
      setSelectedSignalId(null);
      setTooltip(null);
    }
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, interval, outputsize, degreePref]);

  const setup = useMemo<TradeSetup | null>(
    () =>
      snapshot && !snapshot.partial && !snapshot.freshness.stale
        ? detectSetup(snapshot.symbol, snapshot.executionTimeframe, snapshot.candles)
        : null,
    [snapshot],
  );

  const dirColor = setup?.direction === "long" ? "text-success" : "text-destructive";

  const stats = useMemo(() => {
    if (!setup) return null;
    const r = Math.abs(setup.entry - setup.sl);
    const rr1 = Math.abs(setup.tp1 - setup.entry) / r;
    const rr2 = Math.abs(setup.tp2 - setup.entry) / r;
    return { rr1, rr2 };
  }, [setup]);

  const px = (n: number) => n.toFixed(decoded === "XAU/USD" ? 2 : decoded === "USD/JPY" ? 3 : 5);

  const activeSignal = useMemo(
    () => signals.find((s) => s.id === selectedSignalId) ?? null,
    [signals, selectedSignalId],
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <SymbolPicker symbol={decoded} tf={interval} bars={outputsize} />
          <Badge
            variant="outline"
            className="font-mono text-[10px]"
            title="Timeframe contextual — conteo macro"
          >
            Contexto: {contextTf} — Conteo macro
          </Badge>
          <Badge
            variant="outline"
            className="font-mono text-[10px]"
            title="Timeframe de ejecución — subconteo local"
          >
            Ejecución: {interval} — Subconteo local
          </Badge>
          {provider && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {provider}
            </Badge>
          )}
          {snapshot && (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] ${stale ? "text-destructive border-destructive/50" : "text-muted-foreground"}`}
              title={`Proveedor ${snapshot.provider} · última vela cerrada ${new Date(snapshot.lastClosedCandleTime * 1000).toISOString()} · ${snapshot.candles.length} velas · asOf ${new Date(snapshot.asOf * 1000).toISOString()} · build ${snapshot.buildId.slice(0, 8)}`}
            >
              {new Date(snapshot.lastClosedCandleTime * 1000)
                .toISOString()
                .slice(5, 16)
                .replace("T", " ")}
              Z · {px(snapshot.candles[snapshot.candles.length - 1]?.close ?? 0)} ·{" "}
              {formatAge(snapshot.freshness.ageSeconds)}
              {stale ? " · STALE" : ""}
            </Badge>
          )}
          {loading && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-amber-400 border-amber-400/50"
            >
              Cargando {pending?.tf}
            </Badge>
          )}
          {elliott && elliott.status !== "NO_COUNT" && (
            <Badge
              variant="outline"
              className={`font-mono ${elliott.bias === "BULLISH" ? "text-success" : elliott.bias === "BEARISH" ? "text-destructive" : ""}`}
            >
              {elliott.bias} · W{elliott.currentWave ?? "?"} · {elliott.confidence}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ChartViewToggle mode={viewMode} onChange={setViewMode} />
          <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
            {["15min", "1h", "4h", "1day"].map((t) => (
              <button
                key={t}
                onClick={() => setInterval(t)}
                className={`px-3 py-1.5 font-mono ${interval === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
            {HISTORY_PRESETS.map((h) => (
              <button
                key={h.value}
                onClick={() => setOutputsize(h.value)}
                title={h.label}
                className={`px-2.5 py-1.5 font-mono ${outputsize === h.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {h.value}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
            {(["auto", "MAJOR", "INTERMEDIATE", "MINOR"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDegreePref(d)}
                title={`Elliott degree: ${d}`}
                className={`px-2 py-1.5 font-mono ${degreePref === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {d === "auto" ? "Auto" : d.slice(0, 3)}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load({ force: true })}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {decision && <DecisionBanner report={decision} pxFmt={px} />}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <Card className="border-border/60">
          <CardContent className="p-2 relative">
            {(phase || errorMsg) && (
              <div className="absolute right-4 top-4 z-20 max-w-[60%] rounded border border-border bg-popover/95 px-2 py-1 text-xs font-mono shadow">
                {errorMsg ? (
                  <span className="text-destructive">Data error: {errorMsg}</span>
                ) : (
                  <span className="text-muted-foreground">{phase}</span>
                )}
              </div>
            )}
            {candles.length === 0 && !errorMsg && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-xs font-mono text-muted-foreground">
                {phase ?? "Loading market data..."}
              </div>
            )}
            <div
              className={
                outdated || snapshot?.partial
                  ? "opacity-50 transition-opacity"
                  : "transition-opacity"
              }
            >
              <TradingChart
                candles={candles}
                elliott={elliott}
                internal={viewMode === "diagnostic" ? (elliott?.internal ?? null) : null}
                ict={ict}
                layers={layers}
                signal={activeSignal}
                onPivotHover={setTooltip}
                viewMode={viewMode}
              />
            </div>
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 rounded border border-border bg-popover/95 px-2 py-1 text-xs font-mono shadow"
                style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
              >
                <div className="font-bold">
                  Wave {tooltip.label}{" "}
                  <span className={tooltip.confirmed ? "text-success" : "text-muted-foreground"}>
                    ({tooltip.confirmed ? "confirmed" : "provisional"})
                  </span>
                </div>
                <div className="text-muted-foreground">{tooltip.type}</div>
                <div>price: {px(tooltip.price)}</div>
                <div>time: {new Date(tooltip.time).toUTCString()}</div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-4">
            {viewMode === "diagnostic" ? (
              <LayerControls layers={layers} onChange={setLayers} />
            ) : (
              <div className="rounded border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                Vista <span className="font-mono text-foreground">Operational</span> activa. Solo se
                dibuja el setup primario. Cambia a{" "}
                <span className="font-mono text-foreground">Diagnostic</span> para ver todas las
                capas Elliott × ICT.
              </div>
            )}
            <InvalidationLegend elliott={elliott} />
            {(horizon || (import.meta.env.DEV && metrics)) && (
              <div className="rounded border border-border/60 p-2 text-[11px] font-mono text-muted-foreground space-y-0.5">
                {horizon && (
                  <div>
                    horizon: {horizon.candles} candles · {horizon.pivots} pivots · pool{" "}
                    {horizon.pivotsUsed} · degree {elliott?.degree ?? "—"}
                  </div>
                )}
                {snapshot && (
                  <>
                    <div className="break-all">snapshot: {snapshotKey(snapshot)}</div>
                    <div>macro scenario: {snapshot.macroScenarioId ?? "—"}</div>
                  </>
                )}
                {import.meta.env.DEV &&
                  metrics &&
                  Object.entries(metrics).map(([k, v]) => (
                    <div key={k}>
                      {k}: {v}ms
                    </div>
                  ))}
              </div>
            )}
            <ScenariosPanel elliott={elliott} macro={macro} pxFmt={px} />
            <PreRaidApproachPanel symbol={symbol} compact={viewMode !== "diagnostic"} />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Setup</div>
              {setup ? (
                <div className="mt-2 space-y-1 text-sm font-mono">
                  <Row label="Direction" value={setup.direction.toUpperCase()} cls={dirColor} />
                  <Row label="Entry" value={px(setup.entry)} />
                  <Row label="Stop Loss" value={px(setup.sl)} cls="text-destructive" />
                  <Row label="TP1" value={px(setup.tp1)} cls="text-success" />
                  <Row label="TP2" value={px(setup.tp2)} cls="text-success" />
                  {stats && (
                    <>
                      <Row label="RR TP1" value={stats.rr1.toFixed(2)} />
                      <Row label="RR TP2" value={stats.rr2.toFixed(2)} />
                    </>
                  )}
                  <Row label="Wave" value={setup.wave.currentWave ?? "—"} />
                  <Row
                    label="Score"
                    value={`${Math.round(setup.score * 100)}%`}
                    cls="text-primary"
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No confluence detected on the latest candles. The scanner keeps watching.
                </p>
              )}
            </div>
            {setup && (
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Rationale
                </div>
                <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{setup.rationale}</p>
              </div>
            )}
            {ict && (
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  ICT context
                </div>
                <ul className="mt-2 text-xs text-muted-foreground space-y-1">
                  <li>
                    Bias: <span className="text-foreground">{ict.bias}</span>
                  </li>
                  <li>
                    Order Blocks: {ict.orderBlocks.length} (
                    {ict.orderBlocks.filter((o) => o.state === "FRESH").length} fresh,{" "}
                    {ict.orderBlocks.filter((o) => o.state === "BREAKER").length} breaker)
                  </li>
                  {ict.orderBlocks
                    .slice(-3)
                    .reverse()
                    .map((ob) => (
                      <li key={ob.id} className="pl-2">
                        <span
                          className={ob.type === "BULLISH" ? "text-success" : "text-destructive"}
                        >
                          {ob.type}
                        </span>{" "}
                        Q{ob.quality} · {ob.state} · {px(ob.bottom)}–{px(ob.top)}
                      </li>
                    ))}
                  <li>
                    Fair Value Gaps: {ict.fvgs.length} (
                    {ict.fvgs.filter((f) => !f.mitigated).length} fresh)
                  </li>
                  <li>
                    Liquidity: {ict.liquidity.length} (
                    {ict.liquidity.filter((l) => l.state === "ACTIVE").length} active,{" "}
                    {ict.liquidity.filter((l) => l.state === "SWEPT").length} swept)
                  </li>
                  {ict.liquidity
                    .filter((l) => l.state === "ACTIVE")
                    .sort((a, b) => b.strength - a.strength)
                    .slice(0, 3)
                    .map((l) => (
                      <li key={l.id} className="pl-2">
                        <span className={l.side === "BSL" ? "text-success" : "text-destructive"}>
                          {l.kind}
                        </span>{" "}
                        {px(l.price)} · S{l.strength}
                      </li>
                    ))}
                  <li>Liquidity Sweeps: {ict.sweeps.length}</li>
                  {ict.sweeps
                    .slice(-3)
                    .reverse()
                    .map((s) => (
                      <li key={s.id} className="pl-2">
                        <span
                          className={s.type === "sell_side" ? "text-success" : "text-destructive"}
                        >
                          {s.type === "buy_side" ? "BSL raid" : "SSL raid"}
                        </span>{" "}
                        @ {px(s.price)} · Q{s.quality}
                        {s.closeBack ? " · hunt" : ""}
                        {s.displacementAfter ? " · displaced" : ""}
                      </li>
                    ))}
                  <li>Structure events: {ict.structure.length}</li>
                  <li>Killzone: {ict.killzone?.name ?? "—"}</li>
                  <li>
                    PD Array:{" "}
                    {ict.pdArray
                      ? `${ict.pdArray.zone} (${(ict.pdArray.position * 100).toFixed(0)}%)`
                      : "—"}
                  </li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <SignalsPanel
        signals={signals}
        report={decision}
        selectedId={selectedSignalId}
        onSelect={setSelectedSignalId}
        pxFmt={px}
      />
    </div>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}
