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
import { TradingChart, type LayerToggles, type PivotTooltip, type ChartViewMode } from "@/components/chart/TradingChart";
import { LayerControls } from "@/components/chart/LayerControls";
import { ChartViewToggle } from "@/components/chart/ChartViewToggle";
import { InvalidationLegend } from "@/components/chart/InvalidationLegend";
import { SymbolPicker } from "@/components/chart/SymbolPicker";
import { SignalsPanel } from "@/components/chart/SignalsPanel";
import { ScenariosPanel } from "@/components/chart/ScenariosPanel";
import { DecisionBanner } from "@/components/chart/DecisionBanner";
import type { OperationalReport } from "@/lib/detection/decision/types";
import { HISTORY_PRESETS } from "@/lib/symbols";
import { cached, chartKey, Timings, invalidate } from "@/lib/chart/cache";
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
    try { value = decodeURIComponent(value); } catch { /* ignore */ }
  }
  return value;
}

/**
 * Server functions can transiently 404 ("Server function <id> not found")
 * right after a deploy/HMR boundary. Retry those once before surfacing an
 * error to the trader.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String((err as Error)?.message ?? "");
      const transient = /not found|failed to fetch|networkerror|load failed|502|503|504/i.test(msg);
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw last;
}

interface DataHealth {
  provider: string;
  lastCandleIso: string;
  lastClose: number;
  ageSeconds: number;
  stale: boolean;
  candles: number;
}

const DEFAULT_LAYERS: LayerToggles = {
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

  const [candles, setCandles] = useState<Candle[]>([]);
  const [setup, setSetup] = useState<TradeSetup | null>(null);
  const [elliott, setElliott] = useState<ElliottResultDTO | null>(null);
  const [macro, setMacro] = useState<ElliottResultDTO | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [dataHealth, setDataHealth] = useState<DataHealth | null>(null);
  const [ict, setIct] = useState<IctContext | null>(null);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [decision, setDecision] = useState<OperationalReport | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<PivotTooltip | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<string | null>("Loading market data...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const [horizon, setHorizon] = useState<{ candles: number; pivots: number; pivotsUsed: number } | null>(null);
  const [degreePref, setDegreePref] = useState<"auto" | ElliottDegree>("auto");
  const [interval, setInterval] = useState(tf);
  const [outputsize, setOutputsize] = useState(bars);
  const [layers, setLayers] = useState<LayerToggles>(() => loadLayers());
  const [viewMode, setViewMode] = useState<ChartViewMode>("operational");
  const latestRequestRef = useRef(0);
  const prevSymbolRef = useRef(decoded);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chart-layers", JSON.stringify(layers));
  }, [layers]);

  /**
   * Staged pipeline — candles never wait for Elliott/ICT:
   *   A) 200-bar OHLC → render candles
   *   B) full history (lazy) → re-render candles
   *   C) pivots + Elliott (multi-degree) + ICT
   *   D) MTF setups + decision
   * Every stage is cached and deduplicated by symbol|tf|bars.
   */
  async function load(opts: { force?: boolean } = {}) {
    const requestId = ++latestRequestRef.current;
    const alive = () => requestId === latestRequestRef.current;
    const sym = decoded;
    const ivl = interval;
    const t = new Timings();
    if (opts.force) invalidate(chartKey(["ohlc", sym, ivl]));
    setLoading(true);
    setErrorMsg(null);
    setPhase("Loading market data...");

    try {
      // ── Stage A: fast first paint (200 bars) ──────────────────────────────
      const quickBars = Math.min(200, outputsize);
      const quick = await t.measureAsync("apiFetchMs", () =>
        cached(chartKey(["ohlc", sym, ivl, quickBars]), () => withRetry(() =>
          fetch({ data: { symbol: sym, interval: ivl, outputsize: quickBars } }),
        )),
      );
      if (!alive()) return;
      if (quick.candles.length) {
        setCandles(quick.candles);
        setProvider(quick.provider);
        if (quick.meta) setDataHealth(quick.meta);
        t.mark("firstPaintMs");
      }

      // ── Stage B: extended history (lazy, non-blocking for first paint) ────
      let full = quick;
      if (outputsize > quickBars) {
        setPhase("Loading extended history...");
        full = await t.measureAsync("historyFetchMs", () =>
          cached(chartKey(["ohlc", sym, ivl, outputsize]), () => withRetry(() =>
            fetch({ data: { symbol: sym, interval: ivl, outputsize } }),
          )),
        );
        if (!alive()) return;
        if (full.candles.length) {
          setCandles(full.candles);
          setProvider(full.provider);
          if (full.meta) setDataHealth(full.meta);
        } else {
          full = quick;
        }
      }

      if (!full.candles.length) {
        setErrorMsg(full.error ?? quick.error ?? "No market data returned by any provider");
        setPhase(null);
        return;
      }
      setSetup(detectSetup(sym, ivl, full.candles));

      // ── Stage C: Elliott (multi-degree) + ICT ─────────────────────────────
      setPhase("Calculating Elliott structure...");
      const lastTime = full.candles[full.candles.length - 1]?.time ?? 0;
      const ana = await t.measureAsync("elliottMs", () =>
        cached(chartKey(["ana", sym, ivl, outputsize, degreePref, lastTime]), () => withRetry(() =>
          analyze({
            data: {
              symbol: sym,
              interval: ivl,
              outputsize,
              degree: degreePref === "auto" ? undefined : degreePref,
              candles: full.candles,
              includeMacro: true,
            },
          })),
        ),
      );
      if (!alive()) return;
      setElliott(ana.elliott);
      setMacro(ana.macro);
      setIct(ana.ict);
      setHorizon(ana.horizon ?? null);

      // ── Stage D: setups + operational decision ────────────────────────────
      setPhase("Scanning setups...");
      const sigs = await t.measureAsync("setupsMs", () =>
        cached(chartKey(["setups", sym, ivl, outputsize, lastTime]), () => withRetry(() =>
          // Exact same OHLC snapshot the chart is rendering.
          findSetups({ data: { symbol: sym, interval: ivl, outputsize, topN: 3, candles: full.candles } }),
        )),
      );
      if (!alive()) return;
      setSignals(sigs.signals);
      setDecision(sigs.decision);
      setSelectedSignalId((prev) =>
        prev && sigs.signals.some((s) => s.id === prev) ? prev : sigs.signals[0]?.id ?? null,
      );
      setPhase(null);
      setMetrics(t.snapshot());
    } catch (err) {
      if (alive()) {
        console.error("[chart] load failed", err);
        setErrorMsg((err as Error).message || "Failed to load market data");
        setPhase(null);
      }
    } finally {
      if (alive()) setLoading(false);
    }
  }

  useEffect(() => {
    latestRequestRef.current++;
    // Only a symbol switch wipes the canvas; timeframe/bars/degree changes keep
    // the previous drawing visible until fresh data arrives.
    if (prevSymbolRef.current !== decoded) {
      prevSymbolRef.current = decoded;
      setCandles([]);
      setSetup(null);
      setElliott(null);
      setMacro(null);
      setIct(null);
      setSignals([]);
      setDecision(null);
      setSelectedSignalId(null);
      setTooltip(null);
    }
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, interval, outputsize, degreePref]);

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
          <Badge variant="outline" className="font-mono">{interval}</Badge>
          {provider && <Badge variant="secondary" className="font-mono text-[10px]">{provider}</Badge>}
          {elliott && elliott.status !== "NO_COUNT" && (
            <Badge variant="outline" className={`font-mono ${elliott.bias === "BULLISH" ? "text-success" : elliott.bias === "BEARISH" ? "text-destructive" : ""}`}>
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
          <Button size="sm" variant="outline" onClick={() => load({ force: true })} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {decision && (
        <DecisionBanner report={decision} pxFmt={px} />
      )}

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
            <TradingChart
              candles={candles}
              elliott={elliott}
              internal={viewMode === "diagnostic" ? elliott?.internal ?? null : null}
              ict={ict}
              layers={layers}
              signal={activeSignal}
              onPivotHover={setTooltip}
              viewMode={viewMode}
            />
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
                Vista <span className="font-mono text-foreground">Operational</span> activa. Solo se dibuja el setup primario.
                Cambia a <span className="font-mono text-foreground">Diagnostic</span> para ver todas las capas Elliott × ICT.
              </div>
            )}
            <InvalidationLegend elliott={elliott} />
            {(horizon || (import.meta.env.DEV && metrics)) && (
              <div className="rounded border border-border/60 p-2 text-[11px] font-mono text-muted-foreground space-y-0.5">
                {horizon && (
                  <div>
                    horizon: {horizon.candles} candles · {horizon.pivots} pivots · pool {horizon.pivotsUsed} ·{" "}
                    degree {elliott?.degree ?? "—"}
                  </div>
                )}
                {import.meta.env.DEV && metrics &&
                  Object.entries(metrics).map(([k, v]) => (
                    <div key={k}>{k}: {v}ms</div>
                  ))}
              </div>
            )}
            <ScenariosPanel elliott={elliott} macro={macro} pxFmt={px} />
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
                  <Row label="Score" value={`${Math.round(setup.score * 100)}%`} cls="text-primary" />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No confluence detected on the latest candles. The scanner keeps watching.
                </p>
              )}
            </div>
            {setup && (
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Rationale</div>
                <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{setup.rationale}</p>
              </div>
            )}
            {ict && (
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">ICT context</div>
                <ul className="mt-2 text-xs text-muted-foreground space-y-1">
                  <li>Bias: <span className="text-foreground">{ict.bias}</span></li>
                  <li>
                    Order Blocks: {ict.orderBlocks.length} (
                    {ict.orderBlocks.filter((o) => o.state === "FRESH").length} fresh,{" "}
                    {ict.orderBlocks.filter((o) => o.state === "BREAKER").length} breaker)
                  </li>
                  {ict.orderBlocks.slice(-3).reverse().map((ob) => (
                    <li key={ob.id} className="pl-2">
                      <span className={ob.type === "BULLISH" ? "text-success" : "text-destructive"}>{ob.type}</span>{" "}
                      Q{ob.quality} · {ob.state} · {px(ob.bottom)}–{px(ob.top)}
                    </li>
                  ))}
                  <li>Fair Value Gaps: {ict.fvgs.length} ({ict.fvgs.filter((f) => !f.mitigated).length} fresh)</li>
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
                        <span className={l.side === "BSL" ? "text-success" : "text-destructive"}>{l.kind}</span>{" "}
                        {px(l.price)} · S{l.strength}
                      </li>
                    ))}
                  <li>Liquidity Sweeps: {ict.sweeps.length}</li>
                  {ict.sweeps.slice(-3).reverse().map((s) => (
                    <li key={s.id} className="pl-2">
                      <span className={s.type === "sell_side" ? "text-success" : "text-destructive"}>
                        {s.type === "buy_side" ? "BSL raid" : "SSL raid"}
                      </span>{" "}
                      @ {px(s.price)} · Q{s.quality}
                      {s.closeBack ? " · hunt" : ""}
                      {s.displacementAfter ? " · displaced" : ""}
                    </li>
                  ))}
                  <li>Structure events: {ict.structure.length}</li>
                  <li>Killzone: {ict.killzone?.name ?? "—"}</li>
                  <li>PD Array: {ict.pdArray ? `${ict.pdArray.zone} (${(ict.pdArray.position * 100).toFixed(0)}%)` : "—"}</li>
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