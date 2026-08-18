import { it } from "vitest";
import { readFileSync } from "node:fs";
import { liftCandles } from "/dev-server/src/lib/detection/schemas/analysis";
import { detectPivots } from "/dev-server/src/lib/detection/structure/pivots";
import { analyzeElliott } from "/dev-server/src/lib/detection/elliott/engine";
const raw = JSON.parse(readFileSync("/dev-server/src/lib/detection/__tests__/fixtures/xauusd-1d.json","utf8"));
it("probe", () => {
  const a = analyzeElliott(detectPivots(liftCandles(raw)));
  console.log("kind", a.scenarioKind, "state", a.primary!.state, a.primary!.pattern, a.primary!.score.toFixed(3));
  console.log("labels", a.primary!.labeled.map(l=>l.label).join("-"));
  console.log("notes", a.primary!.notes);
  console.log("hyp", (a.hypotheses??[]).map(h=>`${h.kind}:${h.score.toFixed(2)}`).join(" "));
  console.log("alts", a.alternatives.map(c=>`${c.pattern}/${c.state}/${c.score.toFixed(2)}/${c.labeled.map(l=>l.label).join("")}`));
});
