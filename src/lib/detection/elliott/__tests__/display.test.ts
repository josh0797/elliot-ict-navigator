import { describe, expect, it } from "vitest";
import { DEGREE_COLORS, degreeColor, displayWaveLabel } from "../display";

describe("displayWaveLabel", () => {
  it("brackets MAJOR labels", () => {
    expect(displayWaveLabel("1", "MAJOR")).toBe("[1]");
    expect(displayWaveLabel("B", "MAJOR")).toBe("[B]");
  });

  it("leaves INTERMEDIATE labels as canonical numbers/letters", () => {
    expect(displayWaveLabel("3", "INTERMEDIATE")).toBe("3");
    expect(displayWaveLabel("C", "INTERMEDIATE")).toBe("C");
  });

  it("converts 1-5 to i-v and A-C to a-c for MINOR/INTERNAL", () => {
    expect(["1", "2", "3", "4", "5"].map((l) => displayWaveLabel(l, "MINOR"))).toEqual([
      "i",
      "ii",
      "iii",
      "iv",
      "v",
    ]);
    expect(["A", "B", "C"].map((l) => displayWaveLabel(l, "INTERNAL"))).toEqual(["a", "b", "c"]);
  });

  it("never mutates the canonical labels the rules depend on", () => {
    const canonical = ["1", "2", "3", "4", "5", "A", "B", "C"];
    const copy = [...canonical];
    copy.forEach((l) => displayWaveLabel(l, "MINOR"));
    expect(copy).toEqual(canonical);
  });

  it("uses a different colour per degree", () => {
    expect(DEGREE_COLORS.MAJOR).toBe("#A78BFA");
    expect(DEGREE_COLORS.INTERMEDIATE).toBe("#FBBF24");
    expect(DEGREE_COLORS.MINOR).toBe("#22D3EE");
    const colors = new Set([
      degreeColor("MAJOR"),
      degreeColor("INTERMEDIATE"),
      degreeColor("MINOR"),
    ]);
    expect(colors.size).toBe(3);
    expect(degreeColor("INTERNAL")).toBe(DEGREE_COLORS.MINOR);
  });
});
