import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

// Shared TTL helpers for normalized fixtures. Both adapters use the same
// rules to avoid stale data when fixtures are imminent or live, and to
// avoid burning quota when fixtures are far in the future or finished.

export const ONE_MINUTE = 60_000;
export const FIVE_MINUTES = 5 * ONE_MINUTE;
export const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
export const ONE_HOUR = 60 * ONE_MINUTE;
export const ONE_DAY = 24 * ONE_HOUR;

export function pickTtlForFixture(
  kickoffAtMs: number,
  status: NormalizedFixture["status"],
  now: number = Date.now(),
): number {
  if (status === "finished" || status === "cancelled") return ONE_DAY;
  const delta = kickoffAtMs - now;
  if (delta < 2 * ONE_HOUR) return FIVE_MINUTES;
  if (delta > ONE_DAY) return ONE_HOUR;
  return FIFTEEN_MINUTES;
}

export function pickTtlForFixtureCollection(
  fixtures: NormalizedFixture[],
  now: number = Date.now(),
): number {
  if (fixtures.length === 0) return FIVE_MINUTES;
  let minTtl = ONE_DAY;
  for (const f of fixtures) {
    const ttl = pickTtlForFixture(f.kickoffTimestampMs, f.status, now);
    if (ttl < minTtl) minTtl = ttl;
  }
  return minTtl;
}
