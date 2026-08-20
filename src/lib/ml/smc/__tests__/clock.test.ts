import { describe, expect, it } from "vitest";
import { londonClock, londonSession, londonUtcOffsetMinutes } from "../clock";

const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("londonClock — DST", () => {
  it("uses GMT (offset 0) in winter", () => {
    const c = londonClock(utc("2025-01-15T07:30:00Z"));
    expect(c.utcOffsetMinutes).toBe(0);
    expect(c.isDst).toBe(false);
    expect(c.hour).toBe(7);
    expect(c.localDate).toBe("2025-01-15");
  });

  it("uses BST (offset 60) in summer", () => {
    const c = londonClock(utc("2025-07-15T06:30:00Z"));
    expect(c.utcOffsetMinutes).toBe(60);
    expect(c.isDst).toBe(true);
    expect(c.hour).toBe(7);
  });

  it("handles the spring-forward transition", () => {
    expect(londonUtcOffsetMinutes(utc("2025-03-30T00:30:00Z"))).toBe(0);
    expect(londonUtcOffsetMinutes(utc("2025-03-30T01:30:00Z"))).toBe(60);
  });

  it("handles the autumn fall-back transition", () => {
    expect(londonUtcOffsetMinutes(utc("2025-10-26T00:30:00Z"))).toBe(60);
    expect(londonUtcOffsetMinutes(utc("2025-10-26T01:30:00Z"))).toBe(0);
  });
});

describe("LONDON_PRE window", () => {
  it("covers 06:00–07:59 London local in winter", () => {
    expect(londonClock(utc("2025-01-15T06:00:00Z")).session).toBe("LONDON_PRE");
    expect(londonClock(utc("2025-01-15T07:59:00Z")).session).toBe("LONDON_PRE");
    expect(londonClock(utc("2025-01-15T05:59:00Z")).session).toBe("ASIA");
    expect(londonClock(utc("2025-01-15T08:00:00Z")).session).toBe("LONDON");
  });

  it("covers 06:00–07:59 London local in summer (BST shifts UTC by 1h)", () => {
    expect(londonClock(utc("2025-07-15T05:00:00Z")).session).toBe("LONDON_PRE");
    expect(londonClock(utc("2025-07-15T06:59:00Z")).session).toBe("LONDON_PRE");
    expect(londonClock(utc("2025-07-15T07:00:00Z")).session).toBe("LONDON");
  });

  it("classifies remaining sessions", () => {
    expect(londonSession(13 * 60 + 30)).toBe("NY_AM");
    expect(londonSession(18 * 60)).toBe("NY_PM");
    expect(londonSession(12 * 60 + 30)).toBe("OTHER");
  });
});

describe("M30 boundary math", () => {
  it("computes minutes from the last :00/:30 boundary", () => {
    expect(londonClock(utc("2025-01-15T07:00:00Z")).minutesFromM30Boundary).toBe(0);
    expect(londonClock(utc("2025-01-15T07:07:00Z")).minutesFromM30Boundary).toBe(7);
    expect(londonClock(utc("2025-01-15T07:29:00Z")).minutesFromM30Boundary).toBe(29);
    expect(londonClock(utc("2025-01-15T07:31:00Z")).minutesFromM30Boundary).toBe(1);
  });

  it("flags the first 15 minutes and exact boundaries", () => {
    expect(londonClock(utc("2025-01-15T07:14:00Z")).inFirst15mAfterM30).toBe(true);
    expect(londonClock(utc("2025-01-15T07:15:00Z")).inFirst15mAfterM30).toBe(false);
    expect(londonClock(utc("2025-01-15T07:30:00Z")).exactM30Boundary).toBe(true);
    expect(londonClock(utc("2025-01-15T07:31:00Z")).exactM30Boundary).toBe(false);
  });
});
