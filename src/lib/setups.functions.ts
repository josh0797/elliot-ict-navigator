/**
 * Setup detection server functions — thin wrappers.
 * Runtime logic lives in `./detection/analysis.server`.
 */
import { createServerFn } from "@tanstack/react-start";
import { SetupsInput } from "./detection/analysis-schemas";
import { runDetectSetups, runDetectSetupsMTF } from "./detection/analysis.server";
import type { DetectSetupsResult } from "./detection/setup/types";

export const detectSetups = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SetupsInput.parse(d))
  .handler(async ({ data }): Promise<DetectSetupsResult> => runDetectSetups(data));

export const detectSetupsMTF = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SetupsInput.parse(d))
  .handler(
    async ({ data }): Promise<DetectSetupsResult & { htf: string }> => runDetectSetupsMTF(data),
  );
