import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_stored_setups",
  title: "List stored setups",
  description:
    "List setups already detected and stored by the terminal, newest first, optionally filtered by symbol or status.",
  inputSchema: {
    symbol: z.string().min(2).optional().describe("Filter by symbol."),
    status: z.string().min(2).optional().describe("Filter by status, e.g. ACTIVE."),
    limit: z.number().int().min(1).max(50).default(10),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ symbol, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    let query = supabaseForUser(ctx)
      .from("setups")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(limit);
    if (symbol) query = query.eq("symbol", symbol);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw new ToolError(error.message);
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});
