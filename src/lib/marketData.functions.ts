/**
 * Market data server function — thin wrapper.
 *
 * All runtime logic lives in `./marketData/providers.server`; this module only
 * declares the RPC endpoint (TanStack's server-fn split transform deletes
 * sibling runtime declarations from files that declare `createServerFn`).
 */
import { createServerFn } from "@tanstack/react-start";
import { OhlcvInput, VisualHistoryInput } from "./marketData/schemas";
import { loadOhlcv } from "./marketData/providers.server";
import type { OhlcvResponse } from "./marketData/types";
import type { VisualHistoryResponse } from "./marketData/providers.server";

export type { Candle, DataMeta, MarketProvider, OhlcvResponse } from "./marketData/types";
export type { ProviderPreference } from "./marketData/provider-choice";

export const fetchOhlcv = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => OhlcvInput.parse(d))
  .handler(async ({ data }): Promise<OhlcvResponse> => loadOhlcv(data));


/** Deeper VISUAL history (chart context only — no engine consumes it). */
export const fetchVisualHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => VisualHistoryInput.parse(d))
  .handler(async ({ data }): Promise<VisualHistoryResponse> => {
    const { loadVisualHistory } = await import("./marketData/providers.server");
    return loadVisualHistory(data);
  });
