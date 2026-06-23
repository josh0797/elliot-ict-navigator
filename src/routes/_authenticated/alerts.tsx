import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({ meta: [{ title: "Alerts — Elliott × ICT Pro" }] }),
  component: AlertsPage,
});

type SetupRow = {
  id: string;
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  score: number;
  status: string;
  detected_at: string;
};

function AlertsPage() {
  const [setups, setSetups] = useState<SetupRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("setups")
      .select("id,symbol,timeframe,direction,entry,sl,tp1,tp2,score,status,detected_at")
      .order("detected_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    setSetups((data ?? []) as SetupRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("setups-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "setups" }, (payload) => {
        const row = payload.new as SetupRow;
        setSetups((prev) => [row, ...prev].slice(0, 100));
        toast.success(`New ${row.direction.toUpperCase()} setup · ${row.symbol} (${row.timeframe})`);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Signal feed</h1>
        <p className="text-sm text-muted-foreground">Live alerts as confluence is detected. Updates in real time.</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : setups.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No alerts yet. Open the dashboard to start scanning.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {setups.map((s) => (
            <AlertCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({ s }: { s: SetupRow }) {
  const long = s.direction === "long";
  const px = (n: number) => n.toFixed(s.symbol === "USD/JPY" ? 3 : s.symbol === "XAU/USD" ? 2 : 5);
  return (
    <Link
      to="/chart/$symbol"
      params={{ symbol: s.symbol }}
      search={{ tf: s.timeframe }}
    >
      <Card className="border-border/60 hover:border-primary/50 transition-colors">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono text-base flex items-center gap-2">
              {long ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
              {s.symbol}
              <span className="text-xs text-muted-foreground">· {s.timeframe}</span>
            </CardTitle>
            <div className="flex gap-2">
              <Badge variant="outline" className="font-mono">{Math.round(s.score * 100)}%</Badge>
              <Badge variant="outline" className="font-mono uppercase">{s.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-3 text-xs font-mono">
          <Field label="Entry" value={px(s.entry)} />
          <Field label="SL" value={px(s.sl)} cls="text-destructive" />
          <Field label="TP1" value={px(s.tp1)} cls="text-success" />
          <Field label="TP2" value={s.tp2 ? px(s.tp2) : "—"} cls="text-success" />
        </CardContent>
      </Card>
    </Link>
  );
}

function Field({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cls}>{value}</div>
    </div>
  );
}