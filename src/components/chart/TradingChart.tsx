import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type IPriceLine,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { Candle } from "@/lib/twelvedata.functions";
import type { ElliottResultDTO, ElliottWaveDTO } from "@/lib/detection/elliott/types";
import type { IctContext } from "@/lib/detection/ict/types";
import type { TradeSignal } from "@/lib/detection/setup/types";

export interface LayerToggles {
  elliottLines: boolean;
  elliottLabels: boolean;
  alternativeCount: boolean;
  invalidation: boolean;
  fibonacciElliott: boolean;
  liquidity: boolean;
  sweeps: boolean;
}

export interface PivotTooltip {
  x: number;
  y: number;
  label: string;
  price: number;
  time: string;
  type: "HIGH" | "LOW";
  confirmed: boolean;
}

const SEGMENT_COLORS: Record<string, string> = {
  "0-1": "#06b6d4",
  "1-2": "#a855f7",
  "2-3": "#22c55e",
  "3-4": "#f97316",
  "4-5": "#ec4899",
  "5-A": "#ef4444",
  "A-B": "#eab308",
  "B-C": "#fb7185",
};

function segmentColor(a: string, b: string): string {
  return SEGMENT_COLORS[`${a}-${b}`] ?? "#94a3b8";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isValidChartTime(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
function waveTime(w: ElliottWaveDTO, candles: Candle[]): number | null {
  if (w.index >= 0 && w.index < candles.length) {
    const t = candles[w.index].time;
    return isValidChartTime(t) ? t : null;
  }
  const ms = new Date(w.time).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function priceOf(label: string, waves: ElliottWaveDTO[]): number | undefined {
  return waves.find((w) => w.label === label)?.price;
}

export function TradingChart({
  candles,
  elliott,
  ict,
  layers,
  signal,
  onPivotHover,
}: {
  candles: Candle[];
  elliott: ElliottResultDTO | null;
  ict: IctContext | null;
  layers: LayerToggles;
  signal?: TradeSignal | null;
  onPivotHover?: (tip: PivotTooltip | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaysRef = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Init chart once.
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
    candleRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlaysRef.current = [];
      priceLinesRef.current = [];
    };
  }, []);

  // Push candles + overlays whenever data/layers change.
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series || candles.length === 0) return;

    series.setData(
      candles
        .filter(
          (c) =>
            isValidChartTime(c.time) &&
            isFiniteNumber(c.open) &&
            isFiniteNumber(c.high) &&
            isFiniteNumber(c.low) &&
            isFiniteNumber(c.close),
        )
        .map((c) => ({
          time: c.time as unknown as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
    );

    // Clear overlays.
    for (const s of overlaysRef.current) {
      try { chart.removeSeries(s); } catch { /* removed during teardown */ }
    }
    overlaysRef.current = [];
    for (const pl of priceLinesRef.current) {
      try { series.removePriceLine(pl); } catch { /* idem */ }
    }
    priceLinesRef.current = [];

    const renderCount = (waves: ElliottWaveDTO[], opacity: number) => {
      if (waves.length < 2) return;
      // Segmented lines, one series per pair.
      if (layers.elliottLines) {
        for (let i = 1; i < waves.length; i++) {
          const a = waves[i - 1];
          const b = waves[i];
          const ta = waveTime(a, candles);
          const tb = waveTime(b, candles);
          if (ta === null || tb === null || !isFiniteNumber(a.price) || !isFiniteNumber(b.price)) continue;
          const color = segmentColor(a.label, b.label);
          const s = chart.addSeries(LineSeries, {
            color: opacity < 1 ? hexWithAlpha(color, opacity) : color,
            lineWidth: opacity < 1 ? 1 : 2,
            lineStyle: opacity < 1 ? LineStyle.Dotted : LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          s.setData([
            { time: ta as unknown as UTCTimestamp, value: a.price },
            { time: tb as unknown as UTCTimestamp, value: b.price },
          ]);
          overlaysRef.current.push(s);
        }
      }
      if (layers.elliottLabels) {
        // markers attached to a transparent overlay line.
        const m = chart.addSeries(LineSeries, { color: "rgba(0,0,0,0)", priceLineVisible: false, lastValueVisible: false });
        const wavePoints = waves
          .map((w) => ({ t: waveTime(w, candles), w }))
          .filter((p): p is { t: number; w: ElliottWaveDTO } => p.t !== null && isFiniteNumber(p.w.price));
        if (wavePoints.length === 0) {
          try { chart.removeSeries(m); } catch { /* noop */ }
          return;
        }
        m.setData(wavePoints.map((p) => ({ time: p.t as unknown as UTCTimestamp, value: p.w.price })));
        createSeriesMarkers(
          m as unknown as Parameters<typeof createSeriesMarkers>[0],
          wavePoints.map(({ t, w }) => ({
            time: t as unknown as UTCTimestamp,
            position: w.type === "HIGH" ? "aboveBar" : "belowBar",
            color: w.confirmed ? "#facc15" : "rgba(250,204,21,0.5)",
            shape: "circle",
            text: w.confirmed ? w.label : `${w.label}?`,
          })) as Parameters<typeof createSeriesMarkers>[1],
        );
        overlaysRef.current.push(m);
      }
    };

    if (elliott) {
      renderCount(elliott.waves, 1);
      if (layers.alternativeCount && elliott.alternatives.length > 0) {
        renderCount(elliott.alternatives[0].waves, 0.4);
      }

      // Invalidation line.
      if (layers.invalidation && isFiniteNumber(elliott.invalidationLevel)) {
        const failRule = elliott.rules.find((r) => r.status === "FAIL");
        const title = `INV: ${failRule?.code ?? "INVALIDATION"}`;
        const pl = series.createPriceLine({
          price: elliott.invalidationLevel,
          color: "#ef4444",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        });
        priceLinesRef.current.push(pl);
      }

      // Fibonacci Elliott: 0.382/0.5/0.618 retracements of W1 + 1.0/1.618 extensions of W3.
      if (layers.fibonacciElliott) {
        const p0 = priceOf("0", elliott.waves);
        const p1 = priceOf("1", elliott.waves);
        const p3 = priceOf("3", elliott.waves);
        if (isFiniteNumber(p0) && isFiniteNumber(p1)) {
          for (const ratio of [0.382, 0.5, 0.618]) {
            const price = p1 - (p1 - p0) * ratio;
            if (!isFiniteNumber(price)) continue;
            priceLinesRef.current.push(series.createPriceLine({
              price,
              color: "rgba(56,189,248,0.6)",
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `W1 ${(ratio * 100).toFixed(1)}%`,
            }));
          }
        }
        if (isFiniteNumber(p0) && isFiniteNumber(p3)) {
          for (const ext of [1.0, 1.618]) {
            const price = p0 + (p3 - p0) * ext;
            if (!isFiniteNumber(price)) continue;
            priceLinesRef.current.push(series.createPriceLine({
              price,
              color: "rgba(168,85,247,0.5)",
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `W3 ext ${ext}`,
            }));
          }
        }
      }
    }

    // ICT Liquidity overlay: horizontal price lines + BSL/SSL labels + touches + state.
    if (ict && layers.liquidity) {
      // Limit to the top-strength levels (by strength) to keep the chart legible.
      const top = [...ict.liquidity]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 14);
      for (const lvl of top) {
        if (!isFiniteNumber(lvl.price)) continue;
        const isBsl = lvl.side === "BSL";
        const sideColor = lvl.state === "SWEPT"
          ? "rgba(148,163,184,0.55)"
          : lvl.state === "MITIGATED"
            ? "rgba(100,116,139,0.4)"
            : isBsl ? "rgba(34,197,94,0.85)" : "rgba(239,68,68,0.85)";
        const title = `${lvl.side} ${lvl.kind} ×${lvl.touches} · ${lvl.state}`;
        priceLinesRef.current.push(series.createPriceLine({
          price: lvl.price,
          color: sideColor,
          lineWidth: lvl.state === "ACTIVE" ? 2 : 1,
          lineStyle: lvl.state === "SWEPT" ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title,
        }));
      }
    }

    // ICT Sweep markers on the candle that raided the liquidity.
    if (ict && layers.sweeps && ict.sweeps.length > 0) {
      const overlay = chart.addSeries(LineSeries, {
        color: "rgba(0,0,0,0)", priceLineVisible: false, lastValueVisible: false,
      });
      overlay.setData(ict.sweeps
        .filter((s) => s.index >= 0 && s.index < candles.length && isFiniteNumber(s.price) && isValidChartTime(candles[s.index].time))
        .map((s) => ({
          time: candles[s.index].time as unknown as UTCTimestamp,
          value: s.price,
        })));
      createSeriesMarkers(
        overlay as unknown as Parameters<typeof createSeriesMarkers>[0],
        ict.sweeps
          .filter((s) => s.index >= 0 && s.index < candles.length && isFiniteNumber(s.price) && isValidChartTime(candles[s.index].time))
          .map((s) => ({
            time: candles[s.index].time as unknown as UTCTimestamp,
            position: s.type === "buy_side" ? "aboveBar" : "belowBar",
            color: s.type === "buy_side" ? "#ef4444" : "#22c55e",
            shape: s.type === "buy_side" ? "arrowDown" : "arrowUp",
            text: `${s.type === "buy_side" ? "BSL" : "SSL"}·Q${s.quality}`,
          })) as Parameters<typeof createSeriesMarkers>[1],
      );
      overlaysRef.current.push(overlay);
    }

    chart.timeScale().fitContent();

    // Active trade signal overlay (entry / SL / TP1 / TP2).
    if (signal) {
      const rr1 = isFiniteNumber(signal.rrToTp1) ? signal.rrToTp1.toFixed(2) : "—";
      const rr2 = isFiniteNumber(signal.rrToTp2) ? signal.rrToTp2.toFixed(2) : "—";
      const lines: { price: number; color: string; title: string; style: LineStyle }[] = [
        { price: signal.entry, color: "#3b82f6", title: `ENTRY ${signal.direction.toUpperCase()}`, style: LineStyle.Solid },
        { price: signal.sl, color: "#ef4444", title: "SL", style: LineStyle.Dashed },
        { price: signal.tp1, color: "#22c55e", title: `TP1 (${rr1}R)`, style: LineStyle.Dotted },
        { price: signal.tp2, color: "#16a34a", title: `TP2 (${rr2}R)`, style: LineStyle.Dotted },
      ].filter((l) => isFiniteNumber(l.price));
      for (const l of lines) {
        priceLinesRef.current.push(series.createPriceLine({
          price: l.price, color: l.color, lineWidth: 2, lineStyle: l.style,
          axisLabelVisible: true, title: l.title,
        }));
      }
    }

    // Crosshair tooltip — track nearest pivot.
    if (!onPivotHover) return;
    const waves = elliott?.waves ?? [];
    const handler = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time === undefined || waves.length === 0) {
        onPivotHover(null);
        return;
      }
      const t = Number(param.time);
      const w = waves.reduce<ElliottWaveDTO | null>((best, w) => {
        const wt = w.index < candles.length ? candles[w.index].time : Math.floor(new Date(w.time).getTime() / 1000);
        if (Math.abs(wt - t) > 60 * 60 * 6) return best;
        if (!best) return w;
        const bt = best.index < candles.length ? candles[best.index].time : Math.floor(new Date(best.time).getTime() / 1000);
        return Math.abs(wt - t) < Math.abs(bt - t) ? w : best;
      }, null);
      if (!w) {
        onPivotHover(null);
        return;
      }
      onPivotHover({
        x: param.point.x,
        y: param.point.y,
        label: w.label,
        price: w.price,
        time: w.time,
        type: w.type,
        confirmed: w.confirmed,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
    // ICT overlays are intentionally minimal: the legend panel surfaces them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, elliott, ict, layers, signal]);

  return <div ref={containerRef} className="h-[520px] w-full" />;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
