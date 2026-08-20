/**
 * DST-aware Europe/London clock for the SMC_M30 feature family.
 *
 * Deliberately does NOT reuse `src/lib/detection/ict/killzones.ts`, which uses
 * fixed UTC hours and therefore mislabels the empirical pre-London window
 * (~06:00–07:59 London local) during BST.
 */
import type { LondonClock, SmcSession } from "./types";

const LONDON_TZ = "Europe/London";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Session windows in London local minutes-of-day, `[start, end)`.
 * LONDON_PRE covers the empirically strongest window (06:00–07:59 local).
 */
const SESSIONS: Array<{ name: Exclude<SmcSession, "OTHER">; start: number; end: number }> = [
  { name: "ASIA", start: 0, end: 6 * 60 },
  { name: "LONDON_PRE", start: 6 * 60, end: 8 * 60 },
  { name: "LONDON", start: 8 * 60, end: 12 * 60 },
  { name: "NY_AM", start: 13 * 60, end: 17 * 60 },
  { name: "NY_PM", start: 17 * 60, end: 21 * 60 },
];

export function londonSession(minuteOfDay: number): SmcSession {
  const hit = SESSIONS.find((s) => minuteOfDay >= s.start && minuteOfDay < s.end);
  return hit ? hit.name : "OTHER";
}

/** Resolve the London UTC offset (in minutes) at a given instant. */
export function londonUtcOffsetMinutes(unixSec: number): number {
  const parts = partsOf(unixSec);
  // Reconstruct the local wall time as if it were UTC, then diff.
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - unixSec * 1000) / 60000);
}

function partsOf(unixSec: number) {
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(unixSec * 1000))) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) % 24,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday ?? "Mon",
  };
}

/** Build the full London clock snapshot for a UTC timestamp (unix seconds). */
export function londonClock(unixSec: number): LondonClock {
  const p = partsOf(unixSec);
  const minuteOfDay = p.hour * 60 + p.minute;
  const minutesFromM30Boundary = p.minute % 30;
  const offset = londonUtcOffsetMinutes(unixSec);
  return {
    unixSec,
    localDate: `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`,
    hour: p.hour,
    minute: p.minute,
    minuteOfDay,
    dayOfWeek: WEEKDAYS[p.weekday] ?? 1,
    utcOffsetMinutes: offset,
    isDst: offset !== 0,
    minutesFromM30Boundary,
    inFirst15mAfterM30: minutesFromM30Boundary < 15,
    exactM30Boundary: minutesFromM30Boundary === 0 && p.second < 60,
    session: londonSession(minuteOfDay),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

export const SMC_SESSIONS: readonly SmcSession[] = [
  "ASIA",
  "LONDON_PRE",
  "LONDON",
  "NY_AM",
  "NY_PM",
  "OTHER",
] as const;
