/**
 * Build identity shared by the client bundle, the SSR entry and /api/public/health.
 *
 * `__APP_BUILD_ID__` is injected by `vite.config.ts` at config-load time, so
 * the client bundle, the SSR bundle and the server-function manifest produced
 * by the SAME build all carry the SAME id. A mismatch between the id baked
 * into the loaded document/bundle and the one reported by /api/public/health
 * means client and server come from different builds — the exact condition
 * behind "Server function info not found for <hash>".
 */
declare const __APP_BUILD_ID__: string | undefined;

export const APP_BUILD_ID: string =
  typeof __APP_BUILD_ID__ === "string" && __APP_BUILD_ID__.length > 0 ? __APP_BUILD_ID__ : "dev";
