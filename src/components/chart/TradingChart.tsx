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
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
} from "lightweight-charts";
import type { Candle } from "@/lib/twelvedata.functions";
import {
  buildAnchorSeries,
  resolveAnchor,
  type AnchorIssue,
  type AnchorSeries,
} from "@/lib/chart/anchor";

import type { ElliottResultDTO, ElliottWaveDTO } from "@/lib/detection/elliott/types";
import { degreeColor, displayWaveLabel, type DisplayDegree } from "@/lib/detection/elliott/display";
import type { IctContext } from "@/lib/detection/ict/types";
import type { TradeSignal } from "@/lib/detection/setup/types";

export interface LayerToggles {
  /** Primary (highest-priority) Elliott count. */
  primaryCount: boolean;
  /** Lower-degree internal subdivision. */
  internalWaves: boolean;
  elliottLines: boolean;
  elliottLabels: boolean;
  alternativeCount: boolean;
  invalidation: boolean;
  fibonacciElliott: boolean;
  liquidity: boolean;
  sweeps: boolean;
}

export type ChartViewMode = "operational" | "diagnostic";

export interface PivotTooltip {
  x: number;
  y: number;
  label: string;
  price: number;
  time: string;
  type: "HIGH" | "LOW";
  confirmed: boolean;
}

/** Visual role of a rendered count — drives colour weight and label priority. */
type CountRole = "primary" | "internal" | "alternative";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isValidChartTime(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
/**
 * Overlay anchoring is TIMESTAMP-FIRST (see `@/lib/chart/anchor`). `w.index` is
 * relative to the ANALYSIS snapshot, so it must never be applied directly to
 * the (possibly deeper) visual series.
 */


function priceOf(label: string, waves: ElliottWaveDTO[]): number | undefined {
  return waves.find((w) => w.label === label)?.price;
}

export function TradingChart({
  candles,
  elliott,
  internal,
  ict,
  layers,
  signal,
  onPivotHover,
  viewMode = "diagnostic",
  livePrice,
}: {
  candles: Candle[];
  elliott: ElliottResultDTO | null;
  /** Lower-degree subdivision drawn alongside the primary count (diagnostic). */
  internal?: ElliottResultDTO | null;
  ict: IctContext | null;
  layers: LayerToggles;
  signal?: TradeSignal | null;
  onPivotHover?: (tip: PivotTooltip | null) => void;
  viewMode?: ChartViewMode;
  /**
   * UI-ONLY live spot quote. Drawn as a horizontal price line; it is NEVER
   * pushed into `candles` and never reaches Elliott/ICT/setups/ATR/decisions.
   */
  livePrice?: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaysRef = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const fitKeyRef = useRef<string>("");

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
      try {
        markersRef.current?.detach();
      } catch {
        /* removed during teardown */
      }
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlaysRef.current = [];
      priceLinesRef.current = [];
      markersRef.current = null;
    };
  }, []);

  // Push candles + overlays whenever data/layers change.
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return;

    // Clear overlays and marker primitives BEFORE replacing candle data. The
    // chart library recalculates primitives during setData(); stale marker
    // plugins attached to old overlay series can otherwise crash with
    // `Value is null` when the timeframe/history changes.
    try {
      markersRef.current?.detach();
    } catch {
      /* removed during teardown */
    }
    markersRef.current = null;
    for (const s of overlaysRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        /* removed during teardown */
      }
    }
    overlaysRef.current = [];
    for (const pl of priceLinesRef.current) {
      try {
        series.removePriceLine(pl);
      } catch {
        /* idem */
      }
    }
    priceLinesRef.current = [];

    if (candles.length === 0) {
      series.setData([]);
      onPivotHover?.(null);
      return;
    }

    const byTime = new Map<number, Candle>();
    for (const c of candles) {
      if (
        isValidChartTime(c.time) &&
        isFiniteNumber(c.open) &&
        isFiniteNumber(c.high) &&
        isFiniteNumber(c.low) &&
        isFiniteNumber(c.close)
      ) {
        byTime.set(c.time, c);
      }
    }
    const chartCandles = [...byTime.values()].sort((a, b) => a.time - b.time);
    const candleData = chartCandles.map((c) => ({
      time: c.time as unknown as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(candleData);
    if (candleData.length === 0) return;

    // UI-only live spot marker (not part of the analysed series).
    if (isFiniteNumber(livePrice) && livePrice > 0) {
      try {
        priceLinesRef.current.push(
          series.createPriceLine({
            price: livePrice,
            color: "#38bdf8",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: "LIVE",
          }),
        );
      } catch {
        /* price line unsupported — the header badge still shows the quote */
      }
    }

    const validTimes = new Set(chartCandles.map((c) => c.time));
    const sortedTimes = chartCandles.map((c) => c.time);
    /**
     * Snap an arbitrary timestamp (e.g. an HTF pivot time) to the closest
     * rendered candle time. Without this, wave anchors whose exact time is not
     * a candle open silently disappear and nothing is drawn.
     */
    const snapTime = (t: number | null): number | null => {
      if (t === null || sortedTimes.length === 0) return null;
      if (validTimes.has(t)) return t;
      if (t < sortedTimes[0] || t > sortedTimes[sortedTimes.length - 1]) return null;
      let lo = 0;
      let hi = sortedTimes.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (sortedTimes[mid] <= t) lo = mid;
        else hi = mid;
      }
      return t - sortedTimes[lo] <= sortedTimes[hi] - t ? sortedTimes[lo] : sortedTimes[hi];
    };
    const chartMarkers: SeriesMarker<Time>[] = [];
    const pushMarker = (marker: SeriesMarker<Time>) => {
      const t = Number(marker.time);
      if (!isValidChartTime(t) || !validTimes.has(t)) return;
      chartMarkers.push(marker);
    };

    // Label slots already taken, so labels of different degrees never stack on
    // the same anchor. Priority: primary > internal > alternative.
    const usedLabelSlots = new Set<string>();

    const renderCount = (
      waves: ElliottWaveDTO[],
      opts: {
        role: CountRole;
        degree: DisplayDegree;
        showLines: boolean;
        showLabels: boolean;
      },
    ) => {
      const { role, degree, showLines, showLabels } = opts;
      const color = degreeColor(degree);
      const opacity = role === "primary" ? 1 : role === "internal" ? 0.75 : 0.45;
      if (waves.length < 2) return;
      // Segmented lines, one series per pair.
      if (showLines) {
        for (let i = 1; i < waves.length; i++) {
          const a = waves[i - 1];
          const b = waves[i];
          const ta = snapTime(waveTime(a, candles));
          const tb = snapTime(waveTime(b, candles));
          if (
            ta === null ||
            tb === null ||
            ta === tb ||
            !isFiniteNumber(a.price) ||
            !isFiniteNumber(b.price)
          )
            continue;
          const s = chart.addSeries(LineSeries, {
            color: opacity < 1 ? hexWithAlpha(color, opacity) : color,
            lineWidth: role === "primary" ? 2 : 1,
            lineStyle: role === "alternative" ? LineStyle.Dashed : LineStyle.Solid,
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
      if (showLabels) {
        const wavePoints = waves
          .map((w) => ({ t: snapTime(waveTime(w, candles)), w }))
          .filter(
            (p): p is { t: number; w: ElliottWaveDTO } => p.t !== null && isFiniteNumber(p.w.price),
          );
        for (const { t, w } of wavePoints) {
          // Distinct vertical offsets per role prevent visual collisions.
          const position: SeriesMarker<Time>["position"] =
            role === "internal"
              ? "inBar"
              : role === "alternative"
                ? w.type === "HIGH"
                  ? "belowBar"
                  : "aboveBar"
                : w.type === "HIGH"
                  ? "aboveBar"
                  : "belowBar";
          const slot = `${t}:${position}`;
          if (usedLabelSlots.has(slot)) continue;
          usedLabelSlots.add(slot);
          const text = displayWaveLabel(w.label, degree);
          pushMarker({
            id: `elliott-${role}-${w.label}-${t}`,
            time: t as unknown as UTCTimestamp,
            position,
            color: w.confirmed ? hexWithAlpha(color, opacity) : hexWithAlpha(color, opacity * 0.6),
            shape: "circle",
            text: w.confirmed ? text : `${text}?`,
          });
        }
      }
    };

    const isDiag = viewMode === "diagnostic";

    if (elliott) {
      // Operative count = primary unless it was retired/invalidated, in which
      // case the best surviving alternative (e.g. an A-B-C) takes the stage so
      // the labels never disappear from the chart.
      const retired =
        elliott.consistency?.stale === true ||
        elliott.status === "INVALIDATED" ||
        elliott.waves.length === 0;
      const fallback = elliott.alternatives.find((a) => a.waves.length > 0) ?? null;
      const operative = retired && fallback ? fallback : elliott;
      const secondary = operative === elliott ? fallback : elliott;
      const showPrimary = isDiag ? layers.primaryCount : true;
      if (showPrimary) {
        renderCount(operative.waves, {
          role: "primary",
          degree: (operative.degree ?? "INTERMEDIATE") as DisplayDegree,
          showLines: isDiag ? layers.elliottLines : true,
          showLabels: isDiag ? layers.elliottLabels : true,
        });
      }
      if (layers.alternativeCount && secondary && secondary.waves.length > 0) {
        renderCount(secondary.waves, {
          role: "alternative",
          degree: (secondary.degree ?? "INTERMEDIATE") as DisplayDegree,
          showLines: true,
          showLabels: isDiag ? layers.elliottLabels : true,
        });
      }
    }

    // Internal (lower-degree) subdivision: drawn in Diagnostic on top of the
    // major structure so 3-4-5 and W-X-Y coexist instead of replacing each other.
    if (isDiag && layers.internalWaves && internal && internal.waves.length >= 2) {
      renderCount(internal.waves, {
        role: "internal",
        degree: "INTERNAL",
        showLines: layers.elliottLines,
        showLabels: layers.elliottLabels,
      });
    }

    if (isDiag && elliott) {
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

      // Fibonacci Elliott — engine-computed targets for the active wave, with a
      // geometric fallback derived from the labeled pivots.
      if (layers.fibonacciElliott) {
        const engineTargets = elliott.fibTargets ?? [];
        for (const t of engineTargets) {
          if (!isFiniteNumber(t.price)) continue;
          priceLinesRef.current.push(
            series.createPriceLine({
              price: t.price,
              color: t.kind === "RETRACEMENT" ? "rgba(56,189,248,0.6)" : "rgba(168,85,247,0.55)",
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: t.label,
            }),
          );
        }
      }
      if (layers.fibonacciElliott && (elliott.fibTargets ?? []).length === 0) {
        const p0 = priceOf("0", elliott.waves);
        const p1 = priceOf("1", elliott.waves);
        const p3 = priceOf("3", elliott.waves);
        if (isFiniteNumber(p0) && isFiniteNumber(p1)) {
          for (const ratio of [0.382, 0.5, 0.618]) {
            const price = p1 - (p1 - p0) * ratio;
            if (!isFiniteNumber(price)) continue;
            priceLinesRef.current.push(
              series.createPriceLine({
                price,
                color: "rgba(56,189,248,0.6)",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `W1 ${(ratio * 100).toFixed(1)}%`,
              }),
            );
          }
        }
        if (isFiniteNumber(p0) && isFiniteNumber(p3)) {
          for (const ext of [1.0, 1.618]) {
            const price = p0 + (p3 - p0) * ext;
            if (!isFiniteNumber(price)) continue;
            priceLinesRef.current.push(
              series.createPriceLine({
                price,
                color: "rgba(168,85,247,0.5)",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `W3 ext ${ext}`,
              }),
            );
          }
        }
      }
    }

    // ICT Liquidity overlay: horizontal price lines + BSL/SSL labels + touches + state.
    if (isDiag && ict && layers.liquidity) {
      // Limit to the top-strength levels (by strength) to keep the chart legible.
      const top = [...ict.liquidity]
        .filter((l) => l.state === "ACTIVE")
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 6);
      for (const lvl of top) {
        if (!isFiniteNumber(lvl.price)) continue;
        const isBsl = lvl.side === "BSL";
        const sideColor =
          lvl.state === "SWEPT"
            ? "rgba(148,163,184,0.55)"
            : lvl.state === "MITIGATED"
              ? "rgba(100,116,139,0.4)"
              : isBsl
                ? "rgba(34,197,94,0.85)"
                : "rgba(239,68,68,0.85)";
        const title = `${lvl.side} ${lvl.kind} ×${lvl.touches} · ${lvl.state}`;
        priceLinesRef.current.push(
          series.createPriceLine({
            price: lvl.price,
            color: sideColor,
            lineWidth: lvl.state === "ACTIVE" ? 2 : 1,
            lineStyle: lvl.state === "SWEPT" ? LineStyle.Dashed : LineStyle.Solid,
            axisLabelVisible: true,
            title,
          }),
        );
      }
    }

    // ICT Sweep markers on the candle that raided the liquidity.
    if (isDiag && ict && layers.sweeps && ict.sweeps.length > 0) {
      ict.sweeps
        .filter(
          (s) =>
            s.index >= 0 &&
            s.index < candles.length &&
            isFiniteNumber(s.price) &&
            isValidChartTime(candles[s.index].time),
        )
        .forEach((s) => {
          const t = candles[s.index].time;
          pushMarker({
            id: `sweep-${s.id}-${t}`,
            time: candles[s.index].time as unknown as UTCTimestamp,
            position: s.type === "buy_side" ? "aboveBar" : "belowBar",
            color: s.type === "buy_side" ? "#ef4444" : "#22c55e",
            shape: s.type === "buy_side" ? "arrowDown" : "arrowUp",
            text: `${s.type === "buy_side" ? "BSL" : "SSL"}·Q${s.quality}`,
          });
        });
    }

    // Only refit when the dataset itself changed — layer toggles and view-mode
    // switches must not reset the user's zoom/pan.
    const fitKey = `${candleData.length}:${candleData[0]?.time}:${candleData[candleData.length - 1]?.time}`;
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      chart.timeScale().fitContent();
    }

    // Active trade signal overlay (entry / SL / TP1 / TP2).
    if (signal) {
      const rr1 = isFiniteNumber(signal.rrToTp1) ? signal.rrToTp1.toFixed(2) : "—";
      const rr2 = isFiniteNumber(signal.rrToTp2) ? signal.rrToTp2.toFixed(2) : "—";
      const orderLabel = signal.orderType.replace(/_/g, " ");
      const lines: {
        price: number;
        color: string;
        title: string;
        style: LineStyle;
        width?: 1 | 2 | 3;
      }[] = [
        {
          price: signal.entry,
          color: "#3b82f6",
          title: `${orderLabel} ENTRY`,
          style: LineStyle.Solid,
          width: 2,
        },
        {
          price: signal.entryZone.top,
          color: "rgba(59,130,246,0.5)",
          title: "ZONE TOP",
          style: LineStyle.Dotted,
          width: 1,
        },
        {
          price: signal.entryZone.bottom,
          color: "rgba(59,130,246,0.5)",
          title: "ZONE BOT",
          style: LineStyle.Dotted,
          width: 1,
        },
        {
          price: signal.sl,
          color: "#ef4444",
          title: `SL · ${signal.stopReason.replace(/_/g, " ")}`,
          style: LineStyle.Dashed,
          width: 2,
        },
        {
          price: signal.tp1,
          color: "#22c55e",
          title: `TP1 (${rr1}R)`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: signal.tp2,
          color: "#16a34a",
          title: `TP2 (${rr2}R)`,
          style: LineStyle.Dotted,
          width: 2,
        },
      ];
      // TP3 if present
      const tp3 = signal.targets.find((t) => t.name === "TP3");
      if (tp3 && isFiniteNumber(tp3.price)) {
        lines.push({
          price: tp3.price,
          color: "#15803d",
          title: `TP3 (${tp3.rr.toFixed(2)}R)`,
          style: LineStyle.Dotted,
          width: 1,
        });
      }
      // Trigger
      if (signal.trigger && isFiniteNumber(signal.trigger.price)) {
        lines.push({
          price: signal.trigger.price,
          color: "#facc15",
          title: `TRIGGER · ${signal.trigger.type.replace(/_/g, " ")}`,
          style: LineStyle.Dashed,
          width: 2,
        });
      }
      // Invalidation
      if (isFiniteNumber(signal.invalidation.price)) {
        lines.push({
          price: signal.invalidation.price as number,
          color: "#b91c1c",
          title: `INVALIDATION${signal.invalidation.reason ? ` · ${signal.invalidation.reason}` : ""}`,
          style: LineStyle.Dotted,
          width: 1,
        });
      }
      const drawn = lines.filter((l) => isFiniteNumber(l.price));
      for (const l of lines) {
        if (!isFiniteNumber(l.price)) continue;
        priceLinesRef.current.push(
          series.createPriceLine({
            price: l.price,
            color: l.color,
            lineWidth: l.width ?? 2,
            lineStyle: l.style,
            axisLabelVisible: true,
            title: l.title,
          }),
        );
      }
      void drawn;

      // Originating sweep marker.
      if (ict && ict.sweeps.length > 0) {
        const sw = ict.sweeps[ict.sweeps.length - 1];
        if (
          sw &&
          sw.index >= 0 &&
          sw.index < candles.length &&
          isFiniteNumber(sw.price) &&
          isValidChartTime(candles[sw.index].time)
        ) {
          pushMarker({
            id: `active-sweep-${sw.id}-${candles[sw.index].time}`,
            time: candles[sw.index].time as unknown as UTCTimestamp,
            position: sw.type === "buy_side" ? "aboveBar" : "belowBar",
            color: sw.type === "buy_side" ? "#ef4444" : "#22c55e",
            shape: sw.type === "buy_side" ? "arrowDown" : "arrowUp",
            text: `SWEEP ${sw.type === "buy_side" ? "BSL" : "SSL"}`,
          });
        }
      }
    }

    if (chartMarkers.length > 0) {
      chartMarkers.sort((a, b) => Number(a.time) - Number(b.time));
      markersRef.current = createSeriesMarkers(series, chartMarkers);
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
        const wt =
          w.index < candles.length
            ? candles[w.index].time
            : Math.floor(new Date(w.time).getTime() / 1000);
        if (Math.abs(wt - t) > 60 * 60 * 6) return best;
        if (!best) return w;
        const bt =
          best.index < candles.length
            ? candles[best.index].time
            : Math.floor(new Date(best.time).getTime() / 1000);
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
  }, [candles, elliott, internal, ict, layers, signal, viewMode, livePrice]);

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
