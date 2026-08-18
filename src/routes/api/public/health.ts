import { createFileRoute } from "@tanstack/react-router";

import { APP_BUILD_ID } from "@/lib/build-id";

/**
 * Build identity of the DEPLOYED server bundle. Compare it with the build id
 * baked into the loaded client bundle to detect a client/server skew (the cause
 * of "Server function info not found").
 *
 * Must never be cached: only hashed assets may be immutable.
 */
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify({ ok: true, buildId: APP_BUILD_ID, at: new Date().toISOString() }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, must-revalidate",
            },
          },
        ),
    },
  },
});
