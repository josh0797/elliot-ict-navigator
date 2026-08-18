// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// One build id per build, shared by the client bundle, the SSR bundle and the
// server-function manifest. Exposed to the app via `src/lib/build-id.ts` and to
// operators via /api/public/health so a client/server skew is diagnosable.
const buildId =
  process.env["LOVABLE_BUILD_ID"] ??
  process.env["LOVABLE_COMMIT_SHA"] ??
  process.env["GITHUB_SHA"] ??
  process.env["CF_PAGES_COMMIT_SHA"] ??
  `local-${Date.now().toString(36)}`;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
  },
});
