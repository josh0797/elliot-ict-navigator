import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "detect_setups",
  title: "Detect trade setups",
  description:
    "Run the multi-timeframe setup engine and return the operational decision (BUY/SELL/WAIT/NO_TRADE) plus entry, stop and targets for the top candidate setups.",
  inputSchema: {
    symbol: z.string().min(2).describe("Symbol, e.g. XAU/USD."),
    interval: z.string().default("1h").describe("Execution timeframe: 15min, 1h, 4h, 1day."),
    outputsize: z.number().int().min(50).max(5000).default(500).describe("Candles to load."),
    topN: z.number().int().min(1).max(10).default(3).describe("Max setups to return."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ symbol, interval, outputsize, topN }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { runDetectSetupsMTF } = await import("@/lib/detection/analysis.server");
    const result = await runDetectSetupsMTF({
      symbol,
      interval,
      outputsize,
      topN,
      dataStale: false,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: { setups: result as unknown as Record<string, unknown> },
    };
  },
});
