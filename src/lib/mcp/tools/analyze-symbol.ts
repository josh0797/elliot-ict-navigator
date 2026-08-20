import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "analyze_symbol",
  title: "Analyze Elliott + ICT",
  description:
    "Run the Elliott Wave count (with higher-timeframe macro context) and the ICT read (structure, POIs, liquidity) for one symbol and timeframe.",
  inputSchema: {
    symbol: z.string().min(2).describe("Symbol, e.g. XAU/USD or EUR/USD."),
    interval: z
      .string()
      .default("1h")
      .describe("Timeframe: 15min, 1h, 4h, 1day, 1week."),
    outputsize: z.number().int().min(50).max(5000).default(500).describe("Candles to load."),
    includeMacro: z.boolean().default(true).describe("Include the higher-timeframe macro count."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ symbol, interval, outputsize, includeMacro }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { runAnalyzeSymbol } = await import("@/lib/detection/analysis.server");
    const result = await runAnalyzeSymbol({
      symbol,
      interval,
      outputsize,
      includeMacro,
      dataStale: false,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: { analysis: result as unknown as Record<string, unknown> },
    };
  },
});
