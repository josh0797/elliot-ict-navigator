import { describe, expect, it } from "vitest";
import { buildLegacyInput, scoreSignalLegacy } from "../legacyAdapter";
import type { ElliottAnalysis } from "../../elliott/types";

const elliott: ElliottAnalysis = { primary: null, alternatives: [] };

it("legacyAdapter forwards the four required legacy fields", () => {
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
  expect(input.confirmationLevel).toBe(1.1000);
  expect(input.invalidationLevel).toBe(1.0950);
  expect(Number.isFinite(input.fibTarget1 as number)).toBeTruthy();
  expect(input.rrRatio).toBe(2.5);
  expect(input.hasAlternative).toBe(false);
  expect(input.currentPriceApprox).toBe(1.1010);
  expect(input.waveLabel).toBe("2");
});

it("scoreSignalLegacy returns a probability in [0,1]", () => {
    const input = buildLegacyInput(
      { confirmationLevel: 100, invalidationLevel: 95, fibTarget1: 115, rrToTp1: 3, waveLabel: "3", entry: 100 },
      elliott, 101,
    );
    const out = scoreSignalLegacy(input);
  expect(out.probability >= 0 && out.probability <= 1).toBeTruthy();
  expect(out.schema).toBe("legacy-pretrained-html-v1");
});