import { describe, expect, it } from "vitest";

import {
  FIFTEEN_MINUTES,
  FIVE_MINUTES,
  ONE_DAY,
  ONE_HOUR,
  pickTtlForFixture,
  pickTtlForFixtureCollection,
} from "@/lib/providers/sports-data/cache-ttl";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

const NOW = Date.parse("2026-05-15T12:00:00Z");

function fixture(
  overrides: Partial<NormalizedFixture> = {},
): NormalizedFixture {
  return {
    id: "brasileirao_a:2026-05-15T19:00:00Z:Flamengo:Fluminense",
    league: "brasileirao_a",
    kickoffAt: "2026-05-15T19:00:00Z",
    kickoffTimestampMs: Date.parse("2026-05-15T19:00:00Z"),
    homeTeam: "Flamengo",
    awayTeam: "Fluminense",
    status: "scheduled",
    score: { home: null, away: null },
    ...overrides,
  };
}

describe("pickTtlForFixture", () => {
  it("returns ONE_DAY when finished", () => {
    expect(
      pickTtlForFixture(Date.parse("2026-05-14T19:00:00Z"), "finished", NOW),
    ).toBe(ONE_DAY);
  });

  it("returns ONE_DAY when cancelled", () => {
    expect(
      pickTtlForFixture(Date.parse("2026-05-15T19:00:00Z"), "cancelled", NOW),
    ).toBe(ONE_DAY);
  });

  it("returns FIVE_MINUTES when kickoff is < 2h away", () => {
    expect(
      pickTtlForFixture(Date.parse("2026-05-15T13:30:00Z"), "scheduled", NOW),
    ).toBe(FIVE_MINUTES);
  });

  it("returns FIVE_MINUTES for live fixtures (delta could be negative)", () => {
    expect(
      pickTtlForFixture(Date.parse("2026-05-15T11:30:00Z"), "live", NOW),
    ).toBe(FIVE_MINUTES);
  });

  it("returns ONE_HOUR when kickoff is > 24h away", () => {
    expect(
      pickTtlForFixture(Date.parse("2026-05-17T19:00:00Z"), "scheduled", NOW),
    ).toBe(ONE_HOUR);
  });

  it("returns FIFTEEN_MINUTES in the default window", () => {
    expect(
      pickTtlForFixture(Date.parse("2026-05-15T20:00:00Z"), "scheduled", NOW),
    ).toBe(FIFTEEN_MINUTES);
  });
});

describe("pickTtlForFixtureCollection", () => {
  it("returns FIVE_MINUTES for empty collections", () => {
    expect(pickTtlForFixtureCollection([], NOW)).toBe(FIVE_MINUTES);
  });

  it("returns the tightest TTL across the collection", () => {
    const collection: NormalizedFixture[] = [
      fixture({ kickoffTimestampMs: Date.parse("2026-05-17T19:00:00Z") }), // 1h
      fixture({ kickoffTimestampMs: Date.parse("2026-05-15T20:00:00Z") }), // 15min
      fixture({ kickoffTimestampMs: Date.parse("2026-05-15T13:30:00Z") }), // 5min
    ];
    expect(pickTtlForFixtureCollection(collection, NOW)).toBe(FIVE_MINUTES);
  });

  it("returns ONE_HOUR when all fixtures are far in the future", () => {
    const collection: NormalizedFixture[] = [
      fixture({ kickoffTimestampMs: Date.parse("2026-05-17T19:00:00Z") }),
      fixture({ kickoffTimestampMs: Date.parse("2026-05-18T19:00:00Z") }),
    ];
    expect(pickTtlForFixtureCollection(collection, NOW)).toBe(ONE_HOUR);
  });
});
