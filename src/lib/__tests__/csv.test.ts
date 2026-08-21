import { describe, it, expect } from "vitest";
import { buildCsv, csvCell, parseCsv } from "../csv";

describe("csvCell", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("serialises JSON blobs into a single escaped cell", () => {
    const cell = csvCell({ a: 1, b: "x,y" });
    expect(cell.startsWith('"')).toBe(true);
    const roundTrip = parseCsv(buildCsv(["json"], [[{ a: 1, b: "x,y" }]]));
    expect(JSON.parse(roundTrip[0]["json"])).toEqual({ a: 1, b: "x,y" });
  });

  it("blanks null, undefined and non-finite numbers", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("buildCsv", () => {
  it("emits an RFC4180 document that round-trips", () => {
    const csv = buildCsv(
      ["id", "note"],
      [
        ["1", 'a,b"c'],
        ["2", "multi\nline"],
      ],
    );
    expect(csv.endsWith("\r\n")).toBe(true);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]["note"]).toBe('a,b"c');
    expect(rows[1]["note"]).toBe("multi\nline");
  });
});
