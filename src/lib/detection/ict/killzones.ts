import type { Killzone, KillzoneName } from "./types";

const ZONES: Array<{ name: Exclude<KillzoneName, null>; startUtc: number; endUtc: number }> = [
  { name: "ASIA",   startUtc: 0,  endUtc: 5 },
  { name: "LONDON", startUtc: 7,  endUtc: 10 },
  { name: "NY_AM",  startUtc: 12, endUtc: 15 },
  { name: "NY_PM",  startUtc: 18, endUtc: 20 },
];

export function currentKillzone(unixSec: number): Killzone | null {
  const h = new Date(unixSec * 1000).getUTCHours();
  const z = ZONES.find((zone) => h >= zone.startUtc && h < zone.endUtc);
  if (!z) return null;
  return { ...z, activeAt: unixSec };
}
