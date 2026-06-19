import { createFileRoute } from "@tanstack/react-router";
import { detectSetup } from "@/lib/detection/engine";
import type { Candle } from "@/lib/detection/types";
import { scoreSetupML } from "@/lib/detection/model";

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD", "XAU/USD"];
const TFS = ["15min", "1h", "4h"];

async function fetchCandles(symbol: string, interval: string, apiKey: string): Promise<Candle[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", "300");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", apiKey);
  const r = await fetch(url.toString());
  const j = (await r.json()) as { values?: Array<Record<string, string>> };
  if (!j.values) return [];
  return j.values
    .slice()
    .reverse()
    .map((v) => ({
      time: Math.floor(new Date(v.datetime + "Z").getTime() / 1000),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }));
}

async function sendTelegram(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) return { ok: false, error: "Telegram connector not configured" };
  try {
    const r = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function fmt(symbol: string, n: number): string {
  return n.toFixed(symbol === "XAU/USD" ? 2 : symbol === "USD/JPY" ? 3 : 5);
}

export const Route = createFileRoute("/api/public/hooks/scan-and-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Cron auth via apikey header (Supabase anon key)
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const got = request.headers.get("apikey");
        if (!expected || got !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        const apiKey = process.env.TWELVEDATA_API_KEY;
        if (!apiKey) return Response.json({ error: "TWELVEDATA_API_KEY missing" }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1) Scan
        const inserted: Array<{ id: string; symbol: string; tf: string; dir: string; e: number; sl: number; tp1: number; tp2: number; score: number }> = [];
        for (const symbol of PAIRS) {
          for (const tf of TFS) {
            const candles = await fetchCandles(symbol, tf, apiKey);
            if (candles.length < 100) continue;
            const setup = detectSetup(symbol, tf, candles);
            if (!setup || setup.score < 0.6) continue;

            // Blend with trained ML model if active
            const mlProb = await scoreSetupML({
              instrument: symbol,
              timeframe: tf,
              direction: setup.direction === "long" ? "buy" : "sell",
              pattern: "impulse",
              wave_degree: "intermediate",
              wave_current: setup.wave.currentWave,
            });
            const finalScore = mlProb === null ? setup.score : 0.5 * setup.score + 0.5 * mlProb;
            if (finalScore < 0.6) continue;
            setup.score = finalScore;

            // Skip duplicates: same symbol+tf+direction in last 4 hours
            const since = new Date(Date.now() - 4 * 3600_000).toISOString();
            const { data: dup } = await supabaseAdmin
              .from("setups")
              .select("id")
              .eq("symbol", symbol)
              .eq("timeframe", tf)
              .eq("direction", setup.direction)
              .gte("detected_at", since)
              .limit(1);
            if (dup && dup.length) continue;

            const { data, error } = await supabaseAdmin
              .from("setups")
              .insert({
                symbol,
                timeframe: tf,
                direction: setup.direction,
                entry: setup.entry,
                sl: setup.sl,
                tp1: setup.tp1,
                tp2: setup.tp2,
                score: setup.score,
                wave_context: { wave: setup.wave.currentWave, labels: setup.wave.labels },
                ict_context: {
                  ob: setup.ict.orderBlocks.slice(-1),
                  fvg: setup.ict.fvgs.slice(-1),
                  sweep: setup.ict.sweeps.slice(-1),
                  structure: setup.ict.structure.slice(-1),
                },
              })
              .select("id")
              .single();
            if (error || !data) continue;
            inserted.push({
              id: data.id,
              symbol,
              tf,
              dir: setup.direction,
              e: setup.entry,
              sl: setup.sl,
              tp1: setup.tp1,
              tp2: setup.tp2,
              score: setup.score,
            });
          }
        }

        // 2) Notify subscribed users
        if (inserted.length) {
          const { data: profiles } = await supabaseAdmin
            .from("profiles")
            .select("id,telegram_chat_id,alerts_enabled,min_score");
          for (const s of inserted) {
            for (const p of profiles ?? []) {
              if (!p.alerts_enabled || s.score < Number(p.min_score ?? 0.6)) continue;
              await supabaseAdmin.from("alerts").insert({
                setup_id: s.id,
                user_id: p.id,
                channel: "in_app",
              });
              if (p.telegram_chat_id) {
                const arrow = s.dir === "long" ? "🟢" : "🔴";
                const text =
                  `${arrow} <b>${s.symbol}</b> · ${s.tf}\n` +
                  `<b>${s.dir.toUpperCase()}</b> · score ${Math.round(s.score * 100)}%\n\n` +
                  `Entry: <code>${fmt(s.symbol, s.e)}</code>\n` +
                  `SL: <code>${fmt(s.symbol, s.sl)}</code>\n` +
                  `TP1: <code>${fmt(s.symbol, s.tp1)}</code>\n` +
                  `TP2: <code>${fmt(s.symbol, s.tp2)}</code>`;
                const sent = await sendTelegram(p.telegram_chat_id, text);
                await supabaseAdmin.from("alerts").insert({
                  setup_id: s.id,
                  user_id: p.id,
                  channel: "telegram",
                  status: sent.ok ? "sent" : "failed",
                  error: sent.error ?? null,
                });
              }
            }
          }
        }

        return Response.json({ ok: true, inserted: inserted.length });
      },
    },
  },
});