/**
 * Elliott analysis server function — thin wrapper.
 * Runtime logic lives in `./detection/analysis.server`.
 */
import { createServerFn } from "@tanstack/react-start";
import { AnalyzeInput } from "./detection/analysis-schemas";
import { runAnalyzeSymbol } from "./detection/analysis.server";
import type { AnalyzeResponse } from "./detection/analysis-types";

export type { AnalyzeResponse } from "./detection/analysis-types";

export const analyzeSymbol = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data }): Promise<AnalyzeResponse> => runAnalyzeSymbol(data));
