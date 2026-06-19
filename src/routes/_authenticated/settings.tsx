import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Elliott × ICT Pro" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [riskPct, setRiskPct] = useState(1);
  const [minScore, setMinScore] = useState(0.6);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("display_name,telegram_chat_id,alerts_enabled,risk_pct,min_score")
        .eq("id", u.user.id)
        .maybeSingle();
      if (data) {
        setDisplayName(data.display_name ?? "");
        setTelegramId(data.telegram_chat_id ?? "");
        setAlertsEnabled(data.alerts_enabled ?? true);
        setRiskPct(Number(data.risk_pct ?? 1));
        setMinScore(Number(data.min_score ?? 0.6));
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update({
      display_name: displayName || null,
      telegram_chat_id: telegramId || null,
      alerts_enabled: alertsEnabled,
      risk_pct: riskPct,
      min_score: minScore,
    }).eq("id", u.user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Tune alert thresholds and delivery channels.</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dn">Display name</Label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>
            In-app alerts are always active. Set your Telegram chat ID to also receive setups on Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <Label htmlFor="ae">Enable alerts</Label>
            <Switch id="ae" checked={alertsEnabled} onCheckedChange={setAlertsEnabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tg">Telegram chat ID</Label>
            <Input id="tg" placeholder="e.g. 123456789" value={telegramId} onChange={(e) => setTelegramId(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Start a chat with the bot, then paste the chat ID it replies with here.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Minimum confluence score</Label>
              <span className="text-sm font-mono text-primary">{Math.round(minScore * 100)}%</span>
            </div>
            <Slider value={[minScore]} min={0.3} max={1} step={0.05} onValueChange={(v) => setMinScore(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Risk per trade</Label>
              <span className="text-sm font-mono text-primary">{riskPct.toFixed(1)}%</span>
            </div>
            <Slider value={[riskPct]} min={0.25} max={5} step={0.25} onValueChange={(v) => setRiskPct(v[0])} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
    </div>
  );
}