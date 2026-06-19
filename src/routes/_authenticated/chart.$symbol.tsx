import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeSymbol } from "@/lib/elliott.functions";
import { fetchOhlcv } from "@/lib/marketData.functions";
import type { Candle } from "@/lib/twelvedata.functions";
import { detectSetup } from "@/lib/detection/engine";
import type { TradeSetup } from "@/lib/detection/types";
import type { ElliottResultDTO } from "@/lib/detection/elliott/types";
import type { IctContext } from "@/lib/detection/ict/types";
import { TradingChart, type LayerToggles, type PivotTooltip } from "@/components/chart/TradingChart";
import { LayerControls } from "@/components/chart/LayerControls";
import { InvalidationLegend } from "@/components/chart/InvalidationLegend";
import { SymbolPicker } from "@/components/chart/SymbolPicker";
import { HISTORY_PRESETS } from "@/lib/symbols";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";

const Search = z.object({
  tf: z.string().default("1h"),
  bars: z.coerce.number().int().min(50).max(2000).default(500),
});

export const Route = createFileRoute("/_authenticated/chart/$symbol")({
  validateSearch: (s) => Search.parse(s),
  head: ({ params }) => ({
    meta: [{ title: `${decodeURIComponent(params.symbol)} — Elliott × ICT Pro` }],
  }),
  component: ChartPage,
});

const DEFAULT_LAYERS: LayerToggles = {
  elliottLines: true,
  elliottLabels: true,
  alternativeCount: false,
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
  const decoded = decodeURIComponent(symbol);
  const fetch = useServerFn(fetchOhlcv);
  const analyze = useServerFn(analyzeSymbol);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [setup, setSetup] = useState<TradeSetup | null>(null);
  const [elliott, setElliott] = useState<ElliottResultDTO | null>(null);
  const [ict, setIct] = useState<IctContext | null>(null);
  const [tooltip, setTooltip] = useState<PivotTooltip | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState(tf);
  const [outputsize, setOutputsize] = useState(bars);
  const [layers, setLayers] = useState<LayerToggles>(() => loadLayers());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chart-layers", JSON.stringify(layers));
  }, [layers]);

  async function load() {
    setLoading(true);
    const [res, ana] = await Promise.all([
      fetch({ data: { symbol: decoded, interval, outputsize } }),
      analyze({ data: { symbol: decoded, interval, outputsize } }),
    ]);
    if (res.candles.length) {
      setCandles(res.candles);
      setSetup(detectSetup(decoded, interval, res.candles));
    }
    setElliott(ana.elliott);
    setIct(ana.ict);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, interval, outputsize]);

  const dirColor = setup?.direction === "long" ? "text-success" : "text-destructive";

  const stats = useMemo(() => {
    if (!setup) return null;
    const r = Math.abs(setup.entry - setup.sl);
    const rr1 = Math.abs(setup.tp1 - setup.entry) / r;
    const rr2 = Math.abs(setup.tp2 - setup.entry) / r;
    return { rr1, rr2 };
  }, [setup]);

  const px = (n: number) => n.toFixed(decoded === "XAU/USD" ? 2 : decoded === "USD/JPY" ? 3 : 5);

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
          {elliott && elliott.status !== "NO_COUNT" && (
            <Badge variant="outline" className={`font-mono ${elliott.bias === "BULLISH" ? "text-success" : elliott.bias === "BEARISH" ? "text-destructive" : ""}`}>
              {elliott.bias} · W{elliott.currentWave ?? "?"} · {elliott.confidence}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <Card className="border-border/60">
          <CardContent className="p-2 relative">
            <TradingChart
              candles={candles}
              elliott={elliott}
              ict={ict}
              layers={layers}
              onPivotHover={setTooltip}
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
            <LayerControls layers={layers} onChange={setLayers} />
            <InvalidationLegend elliott={elliott} />
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