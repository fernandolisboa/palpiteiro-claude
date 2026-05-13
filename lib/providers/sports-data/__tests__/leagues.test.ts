import { describe, expect, it } from "vitest";

import {
  API_FOOTBALL_LEAGUE_IDS,
  FOOTBALL_DATA_ORG_LEAGUE_CODES,
  SUPPORTED_LEAGUES,
  currentSeason,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

describe("SUPPORTED_LEAGUES", () => {
  it("includes brasileirao_a and champions_league", () => {
    expect(SUPPORTED_LEAGUES).toEqual(["brasileirao_a", "champions_league"]);
  });
});

describe("provider league maps", () => {
  it("API_FOOTBALL_LEAGUE_IDS covers every SupportedLeague", () => {
    for (const l of SUPPORTED_LEAGUES) {
      expect(API_FOOTBALL_LEAGUE_IDS[l]).toBeTypeOf("number");
    }
  });

  it("FOOTBALL_DATA_ORG_LEAGUE_CODES covers every SupportedLeague", () => {
    for (const l of SUPPORTED_LEAGUES) {
      expect(FOOTBALL_DATA_ORG_LEAGUE_CODES[l]).toBeTypeOf("string");
      expect(FOOTBALL_DATA_ORG_LEAGUE_CODES[l].length).toBeGreaterThan(0);
    }
  });

  it("expected API-Football IDs", () => {
    expect(API_FOOTBALL_LEAGUE_IDS.brasileirao_a).toBe(71);
    expect(API_FOOTBALL_LEAGUE_IDS.champions_league).toBe(2);
  });

  it("expected football-data.org codes", () => {
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.brasileirao_a).toBe("BSA");
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.champions_league).toBe("CL");
  });
});

describe("currentSeason — Brasileirão Série A (calendar-year)", () => {
  // Brasileirão runs April–December. January–March is the off-season; the
  // "current" season label is still the year that just ended, since the
  // upcoming season hasn't started yet.
  it("January → previous year (season hasn't started in April yet)", () => {
    expect(
      currentSeason("brasileirao_a", new Date("2026-01-15T12:00:00Z")),
    ).toBe(2025);
  });

  it("April → current year (season just started)", () => {
    expect(
      currentSeason("brasileirao_a", new Date("2026-04-15T12:00:00Z")),
    ).toBe(2026);
  });

  it("March 31 → previous year (final day before transition)", () => {
    expect(
      currentSeason("brasileirao_a", new Date("2026-03-31T23:59:59Z")),
    ).toBe(2025);
  });

  it("December → current year (mid-season)", () => {
    expect(
      currentSeason("brasileirao_a", new Date("2026-12-01T12:00:00Z")),
    ).toBe(2026);
  });
});

describe("currentSeason — Champions League (cross-year)", () => {
  // Champions League runs August (previous year)–May. The label is the year
  // the season STARTED. January–July uses the prior year's label.
  it("January → previous year (season started in August of prior year)", () => {
    expect(
      currentSeason("champions_league", new Date("2026-01-15T12:00:00Z")),
    ).toBe(2025);
  });

  it("July → previous year (final off-season month)", () => {
    expect(
      currentSeason("champions_league", new Date("2026-07-15T12:00:00Z")),
    ).toBe(2025);
  });

  it("August → current year (new season starts)", () => {
    expect(
      currentSeason("champions_league", new Date("2026-08-15T12:00:00Z")),
    ).toBe(2026);
  });

  it("December → current year (mid-season)", () => {
    expect(
      currentSeason("champions_league", new Date("2026-12-01T12:00:00Z")),
    ).toBe(2026);
  });
});

describe("SupportedLeague type", () => {
  it("widens narrow string literals correctly", () => {
    const value: SupportedLeague = "brasileirao_a";
    expect(SUPPORTED_LEAGUES).toContain(value);
  });
});
