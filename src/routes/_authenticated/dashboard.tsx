import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { fetchCandles } from "@/lib/twelvedata.functions";
import { detectSetup } from "@/lib/detection/engine";
import type { TradeSetup } from "@/lib/detection/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, TrendingUp, TrendingDown, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Elliott × ICT Pro" }] }),
  component: Dashboard,
});

const DEFAULT_PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD", "XAU/USD"];
const TIMEFRAME = "1h";

type Row = {
  symbol: string;
  loading: boolean;
  price: number | null;
  setup: TradeSetup | null;
  error?: string;
};

function Dashboard() {
  const fetch = useServerFn(fetchCandles);
  const [rows, setRows] = useState<Row[]>(
    DEFAULT_PAIRS.map((s) => ({ symbol: s, loading: true, price: null, setup: null })),
  );
  const [tf, setTf] = useState<string>(TIMEFRAME);
  const [refreshing, setRefreshing] = useState(false);

  async function scan() {
    setRefreshing(true);
    const results = await Promise.all(
      DEFAULT_PAIRS.map(async (symbol) => {
        const res = await fetch({ data: { symbol, interval: tf, outputsize: 300 } });
        if (res.error || res.candles.length === 0) {
          return { symbol, loading: false, price: null, setup: null, error: res.error };
        }
        const last = res.candles[res.candles.length - 1];
        const setup = detectSetup(symbol, tf, res.candles);
        return { symbol, loading: false, price: last.close, setup };
      }),
    );
    setRows(results);
    setRefreshing(false);

    // Persist detected setups (best-effort) and surface a toast for high-score ones
    const fresh = results.filter((r) => r.setup && r.setup.score >= 0.6);
    for (const r of fresh) {
      if (!r.setup) continue;
      try {
        await supabase.from("setups").insert({
          symbol: r.setup.symbol,
          timeframe: r.setup.timeframe,
          direction: r.setup.direction,
          entry: r.setup.entry,
          sl: r.setup.sl,
          tp1: r.setup.tp1,
          tp2: r.setup.tp2,
          score: r.setup.score,
          wave_context: { wave: r.setup.wave.currentWave, pivots: r.setup.wave.pivots },
          ict_context: { ob: r.setup.ict.orderBlocks.slice(-1), fvg: r.setup.ict.fvgs.slice(-1) },
        });
      } catch {
        /* ignore RLS/dup */
      }
    }
    if (fresh.length) toast.success(`${fresh.length} high-confluence setup(s) detected`);
  }

  useEffect(() => {
    scan();
    const id = setInterval(scan, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  const activeCount = useMemo(() => rows.filter((r) => r.setup).length, [rows]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Market scanner</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} active setup{activeCount === 1 ? "" : "s"} across {DEFAULT_PAIRS.length} instruments · auto-refresh 60s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card overflow-hidden text-xs">
            {["15min", "1h", "4h"].map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`px-3 py-1.5 font-mono ${tf === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={scan} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${refreshing ? "animate-spin" : ""}`} /> Scan
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((r) => (
          <PairCard key={r.symbol} row={r} tf={tf} />
        ))}
      </div>
    </div>
  );
}

function PairCard({ row, tf }: { row: Row; tf: string }) {
  const setup = row.setup;
  const dirBadge = setup?.direction === "long" ? "success" : "destructive";
  return (
    <Link
      to="/chart/$symbol"
      params={{ symbol: encodeURIComponent(row.symbol) }}
      search={{ tf }}
      className="group"
    >
      <Card className="border-border/60 hover:border-primary/50 transition-colors">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono text-base">{row.symbol}</CardTitle>
            <span className="text-xs text-muted-foreground font-mono uppercase">{tf}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {row.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : row.error ? (
            <div className="text-xs text-destructive">{row.error}</div>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-mono font-semibold">
                  {row.price?.toFixed(row.symbol === "USD/JPY" ? 3 : row.symbol === "XAU/USD" ? 2 : 5)}
                </span>
                {setup && (
                  <Badge
                    className={
                      dirBadge === "success"
                        ? "bg-success/15 text-success border-success/30"
                        : "bg-destructive/15 text-destructive border-destructive/30"
                    }
                    variant="outline"
                  >
                    {setup.direction === "long" ? (
                      <TrendingUp className="h-3 w-3 mr-1" />
                    ) : (
                      <TrendingDown className="h-3 w-3 mr-1" />
                    )}
                    {setup.direction.toUpperCase()}
                  </Badge>
                )}
              </div>
              {setup ? (
                <div className="text-xs space-y-1 font-mono">
                  <Line label="Entry" value={setup.entry} />
                  <Line label="SL" value={setup.sl} cls="text-destructive" />
                  <Line label="TP1" value={setup.tp1} cls="text-success" />
                  <div className="flex items-center justify-between pt-1 text-muted-foreground">
                    <span>Score</span>
                    <span className="text-primary">{(setup.score * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" /> No confluence yet
                </div>
              )}
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 flex items-center justify-end pt-1 group-hover:text-primary">
                Open chart <ArrowRight className="h-3 w-3 ml-1" />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function Line({ label, value, cls }: { label: string; value: number; cls?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cls}>{value.toFixed(5)}</span>
    </div>
  );
}