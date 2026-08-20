import { auth, defineMcp } from "@lovable.dev/mcp-js";
import analyzeSymbolTool from "./tools/analyze-symbol";
import detectSetupsTool from "./tools/detect-setups";
import listMyAlertsTool from "./tools/list-my-alerts";
import listStoredSetupsTool from "./tools/list-stored-setups";
import listSymbolsTool from "./tools/list-symbols";

// The OAuth issuer must be the direct Supabase host: the project ref is the only
// value that survives publish unchanged, and Vite inlines it at build time.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "wave-ict-trader",
  title: "Wave ICT Trader",
  version: "0.1.0",
  instructions:
    "Elliott Wave + ICT trading terminal. Use `list_symbols` to discover symbols, `analyze_symbol` for the wave count and ICT read, `detect_setups` for the operational BUY/SELL/WAIT decision with entry, stop and targets, and `list_stored_setups` / `list_my_alerts` for saved history. Analysis is informational, not financial advice.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listSymbolsTool,
    analyzeSymbolTool,
    detectSetupsTool,
    listStoredSetupsTool,
    listMyAlertsTool,
  ],
});
