import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, BellRing, LineChart, Layers, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Elliott × ICT Pro — Real-time Wave + Smart Money signals" },
      {
        name: "description",
        content:
          "Automated Elliott Wave counts confluenced with ICT order blocks, FVGs and liquidity sweeps. Entry, SL and TP delivered in real time for FX majors and Gold.",
      },
      { property: "og:title", content: "Elliott × ICT Pro" },
      {
        property: "og:description",
        content: "Real-time Wave + Smart Money trading terminal for FX majors and Gold.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <Activity className="h-5 w-5" />
            <span className="font-mono font-bold text-sm tracking-tight">ELLIOTT × ICT PRO</span>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="ghost"><Link to="/auth">Sign in</Link></Button>
            <Button asChild><Link to="/auth">Launch terminal</Link></Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-mono uppercase tracking-widest text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Live · 7 FX majors + XAU/USD
          </div>
          <h1 className="mt-6 text-5xl font-bold tracking-tight md:text-6xl">
            Wave counts meet <span className="text-primary">smart money</span>.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            A trading terminal that automatically counts Elliott Waves, overlays ICT
            order blocks, fair-value gaps and liquidity sweeps, then pushes
            actionable setups with entry, stop-loss and take-profit — in the app and
            on Telegram — the moment confluence appears.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg">
              <Link to="/auth">
                Open the terminal <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-20 grid md:grid-cols-3 gap-6">
          <Feature icon={LineChart} title="Elliott auto-count">
            ZigZag pivots scored against the three Elliott rules (W2≤100% W1, W3
            never shortest, W4 cannot overlap W1).
          </Feature>
          <Feature icon={Layers} title="ICT overlay">
            Order Blocks, Fair Value Gaps, Liquidity Sweeps and BOS/CHoCH printed
            directly on the chart.
          </Feature>
          <Feature icon={BellRing} title="Confluence alerts">
            Only setups where ICT confirms the end of an Elliott correction
            trigger an alert — in the app and on Telegram.
          </Feature>
        </div>

        <div className="mt-12 rounded-xl border border-border/60 bg-card p-6 flex flex-wrap items-center gap-6 justify-between">
          <div className="flex items-center gap-3">
            <Cpu className="h-6 w-6 text-primary" />
            <div>
              <div className="font-semibold">Self-improving model</div>
              <div className="text-sm text-muted-foreground">
                TF.js retrains on real setup outcomes stored in the cloud.
              </div>
            </div>
          </div>
          <Button asChild variant="outline"><Link to="/auth">Get started free</Link></Button>
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Activity;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-6">
      <Icon className="h-6 w-6 text-primary" />
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
