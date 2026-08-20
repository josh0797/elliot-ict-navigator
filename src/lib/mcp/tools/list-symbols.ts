import { defineTool } from "@lovable.dev/mcp-js";
import { SYMBOL_CATALOG } from "@/lib/symbols";

export default defineTool({
  name: "list_symbols",
  title: "List tradable symbols",
  description:
    "List the FX, metals and crypto symbols this terminal can analyze, with their asset group.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text", text: JSON.stringify(SYMBOL_CATALOG) }],
    structuredContent: { symbols: SYMBOL_CATALOG },
  }),
});
