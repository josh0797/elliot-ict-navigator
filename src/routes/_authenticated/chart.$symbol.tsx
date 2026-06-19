import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { fetchCandles } from "@/lib/twelvedata.functions";
import { detectSetup } from "@/lib/detection/engine";
import type { Candle, TradeSetup } from "@/lib/detection/types";
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";

const Search = z.object({ tf: z.string().default("1h") });

export const Route = createFileRoute("/_authenticated/chart/$symbol")({
  validateSearch: (s) => Search.parse(s),
  head: ({ params }) => ({
    meta: [{ title: `${decodeURIComponent(params.symbol)} — Elliott × ICT Pro` }],
  }),
  component: ChartPage,
});

function ChartPage() {
  const { symbol } = Route.useParams();
  const { tf } = Route.useSearch();
  const decoded = decodeURIComponent(symbol);
  const fetch = useServerFn(fetchCandles);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaysRef = useRef<Array<ISeriesApi<"Line">>>([]);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [setup, setSetup] = useState<TradeSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState(tf);

  // Initialise chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#cbd5e1" },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.2)" },
      timeScale: { borderColor: "rgba(148,163,184,0.2)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch({ data: { symbol: decoded, interval, outputsize: 500 } });
    if (res.candles.length) {
      setCandles(res.candles);
      setSetup(detectSetup(decoded, interval, res.candles));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, interval]);

  // Push data + overlays to the chart whenever data changes
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;
    series.setData(
      candles.map((c) => ({
        time: c.time as unknown as import("lightweight-charts").UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    // remove previous overlays
    for (const s of overlaysRef.current) chart.removeSeries(s);
    overlaysRef.current = [];

    if (setup) {
      // Elliott zigzag line
      const zz = chart.addSeries(LineSeries, { color: "#facc15", lineWidth: 2 });
      zz.setData(
        setup.wave.pivots.map((p) => ({
          time: p.time as unknown as import("lightweight-charts").UTCTimestamp,
          value: p.price,
        })),
      );
      // Label markers
      createSeriesMarkers(
        zz as unknown as Parameters<typeof createSeriesMarkers>[0],
        setup.wave.pivots.map((p, i) => ({
          time: p.time as unknown as import("lightweight-charts").UTCTimestamp,
          position: p.type === "H" ? "aboveBar" : "belowBar",
          color: "#facc15",
          shape: "circle",
          text: setup.wave.labels[i] ?? "",
        })) as Parameters<typeof createSeriesMarkers>[1],
      );
      overlaysRef.current.push(zz);

      // Horizontal lines for Entry / SL / TP
      const addLine = (price: number, color: string, title: string) => {
        series.createPriceLine({ price, color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title });
      };
      addLine(setup.entry, "#38bdf8", "ENTRY");
      addLine(setup.sl, "#ef4444", "SL");
      addLine(setup.tp1, "#22c55e", "TP1");
      addLine(setup.tp2, "#22c55e", "TP2");
    }
    chart.timeScale().fitContent();
  }, [candles, setup]);

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
          <h1 className="text-xl font-mono font-bold">{decoded}</h1>
          <Badge variant="outline" className="font-mono">{interval}</Badge>
          {setup && (
            <Badge variant="outline" className={`font-mono ${dirColor}`}>
              {setup.direction.toUpperCase()} · {Math.round(setup.score * 100)}%
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
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <Card className="border-border/60">
          <CardContent className="p-2">
            <div ref={containerRef} className="h-[520px] w-full" />
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-4">
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
            {setup && (
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">ICT context</div>
                <ul className="mt-2 text-xs text-muted-foreground space-y-1">
                  <li>Order Blocks: {setup.ict.orderBlocks.length}</li>
                  <li>Fair Value Gaps: {setup.ict.fvgs.length}</li>
                  <li>Liquidity Sweeps: {setup.ict.sweeps.length}</li>
                  <li>Structure events: {setup.ict.structure.length}</li>
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