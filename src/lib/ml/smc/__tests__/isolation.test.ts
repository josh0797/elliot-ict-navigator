import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src/lib/ml/smc");
const FORBIDDEN = [
  "elliott",
  "/lib/ml/dataset",
  "/lib/ml/logreg",
  "detection/setup",
  "detection/engine",
  "killzones",
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sources(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

describe("src/lib/ml/smc isolation", () => {
  it("never imports Elliott or the Elliott feature pipeline", () => {
    for (const file of sources(DIR)) {
      const src = readFileSync(file, "utf8");
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        for (const bad of FORBIDDEN) {
          expect(spec.toLowerCase().includes(bad), `${file} imports ${spec}`).toBe(false);
        }
      }
    }
  });
});
