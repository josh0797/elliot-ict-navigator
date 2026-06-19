import { createFileRoute } from "@tanstack/react-router";

async function getPrice(symbol: string, apiKey: string): Promise<number | null> {
  const r = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
  const j = (await r.json()) as { price?: string };
  return j.price ? Number(j.price) : null;
}

export const Route = createFileRoute("/api/public/hooks/evaluate-results")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const got = request.headers.get("apikey");
        if (!expected || got !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        const apiKey = process.env.TWELVEDATA_API_KEY;
        if (!apiKey) return Response.json({ error: "TWELVEDATA_API_KEY missing" }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: openSetups } = await supabaseAdmin
          .from("setups")
          .select("id,symbol,direction,entry,sl,tp1,tp2,detected_at")
          .eq("status", "pending");
        if (!openSetups?.length) return Response.json({ ok: true, evaluated: 0 });

        // Cache prices per symbol
        const prices = new Map<string, number>();
        for (const s of openSetups) {
          if (!prices.has(s.symbol)) {
            const p = await getPrice(s.symbol, apiKey);
            if (p != null) prices.set(s.symbol, p);
          }
        }

        let updated = 0;
        for (const s of openSetups) {
          const px = prices.get(s.symbol);
          if (px == null) continue;
          const long = s.direction === "long";
          const entry = Number(s.entry);
          const sl = Number(s.sl);
          const tp1 = Number(s.tp1);
          const tp2 = s.tp2 != null ? Number(s.tp2) : null;
          let outcome: "tp1" | "tp2" | "sl" | null = null;
          if (long) {
            if (px <= sl) outcome = "sl";
            else if (tp2 != null && px >= tp2) outcome = "tp2";
            else if (px >= tp1) outcome = "tp1";
          } else {
            if (px >= sl) outcome = "sl";
            else if (tp2 != null && px <= tp2) outcome = "tp2";
            else if (px <= tp1) outcome = "tp1";
          }
          // Expire after 72h
          const age = (Date.now() - new Date(s.detected_at).getTime()) / 3600_000;
          if (!outcome && age > 72) {
            await supabaseAdmin.from("setups").update({ status: "expired", closed_at: new Date().toISOString() }).eq("id", s.id);
            updated++;
            continue;
          }
          if (!outcome) continue;

          const r = Math.abs(entry - sl) || 1;
          const exit = outcome === "sl" ? sl : outcome === "tp1" ? tp1 : (tp2 ?? tp1);
          const rMult = ((long ? exit - entry : entry - exit) / r);
          await supabaseAdmin
            .from("setups")
            .update({ status: outcome, closed_at: new Date().toISOString(), rr: rMult })
            .eq("id", s.id);
          await supabaseAdmin.from("trade_results").insert({ setup_id: s.id, outcome, r_multiple: rMult });
          updated++;
        }
        return Response.json({ ok: true, evaluated: updated });
      },
    },
  },
});