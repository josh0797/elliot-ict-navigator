import { test } from "vitest";
import assert from "node:assert/strict";
import { buildLegacyInput, scoreSignalLegacy } from "../legacyAdapter";
import type { ElliottAnalysis } from "../../elliott/types";

const elliott: ElliottAnalysis = { primary: null, alternatives: [] };

test("legacyAdapter forwards the four required legacy fields", () => {
    const input = buildLegacyInput(
      {
        confirmationLevel: 1.1000,
        invalidationLevel: 1.0950,
        fibTarget1: 1.1150,
        rrToTp1: 2.5,
        waveLabel: "2",
        entry: 1.1000,
      },
      elliott,
      1.1010,
    );
  assert.equal(input.confirmationLevel, 1.1000);
  assert.equal(input.invalidationLevel, 1.0950);
  assert.ok(Number.isFinite(input.fibTarget1 as number));
  assert.equal(input.rrRatio, 2.5);
  assert.equal(input.hasAlternative, false);
  assert.equal(input.currentPriceApprox, 1.1010);
  assert.equal(input.waveLabel, "2");
});

test("scoreSignalLegacy returns a probability in [0,1]", () => {
    const input = buildLegacyInput(
      { confirmationLevel: 100, invalidationLevel: 95, fibTarget1: 115, rrToTp1: 3, waveLabel: "3", entry: 100 },
      elliott, 101,
    );
    const out = scoreSignalLegacy(input);
  assert.ok(out.probability >= 0 && out.probability <= 1);
  assert.equal(out.schema, "legacy-pretrained-html-v1");
});