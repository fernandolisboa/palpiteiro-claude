import { describe, expect, it } from "vitest";

import {
  API_FOOTBALL_LEAGUE_IDS,
  FOOTBALL_DATA_ORG_LEAGUE_CODES,
  SUPPORTED_LEAGUES,
  currentSeason,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

describe("SUPPORTED_LEAGUES", () => {
  it("includes the Brazilian, UEFA, World Cup, European domestic leagues and CONMEBOL cups", () => {
    expect(SUPPORTED_LEAGUES).toEqual([
      "brasileirao_a",
      "champions_league",
      "world_cup",
      "serie_a",
      "bundesliga",
      "ligue_1",
      "copa_libertadores",
      "copa_sudamericana",
    ]);
  });
});

describe("provider league maps", () => {
  it("API_FOOTBALL_LEAGUE_IDS covers every SupportedLeague", () => {
    for (const l of SUPPORTED_LEAGUES) {
      expect(API_FOOTBALL_LEAGUE_IDS[l]).toBeTypeOf("number");
    }
  });

  it("FOOTBALL_DATA_ORG_LEAGUE_CODES covers every league except the CONMEBOL cups", () => {
    const notServed: SupportedLeague[] = ["copa_libertadores", "copa_sudamericana"];
    for (const l of SUPPORTED_LEAGUES) {
      const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[l];
      if (notServed.includes(l)) {
        expect(code).toBeUndefined();
      } else {
        expect(code).toBeTypeOf("string");
        expect(code?.length).toBeGreaterThan(0);
      }
    }
  });

  it("expected API-Football IDs", () => {
    expect(API_FOOTBALL_LEAGUE_IDS.brasileirao_a).toBe(71);
    expect(API_FOOTBALL_LEAGUE_IDS.champions_league).toBe(2);
    expect(API_FOOTBALL_LEAGUE_IDS.world_cup).toBe(1);
    expect(API_FOOTBALL_LEAGUE_IDS.serie_a).toBe(135);
    expect(API_FOOTBALL_LEAGUE_IDS.bundesliga).toBe(78);
    expect(API_FOOTBALL_LEAGUE_IDS.ligue_1).toBe(61);
    expect(API_FOOTBALL_LEAGUE_IDS.copa_libertadores).toBe(13);
    expect(API_FOOTBALL_LEAGUE_IDS.copa_sudamericana).toBe(11);
  });

  it("expected football-data.org codes", () => {
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.brasileirao_a).toBe("BSA");
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.champions_league).toBe("CL");
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.world_cup).toBe("WC");
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.serie_a).toBe("SA");
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.bundesliga).toBe("BL1");
    expect(FOOTBALL_DATA_ORG_LEAGUE_CODES.ligue_1).toBe("FL1");
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

describe("currentSeason — CONMEBOL cups (calendar-year, Feb–Nov)", () => {
  for (const league of ["copa_libertadores", "copa_sudamericana"] as const) {
    it(`${league}: January → previous year (new edition not started)`, () => {
      expect(currentSeason(league, new Date("2027-01-31T23:59:59Z"))).toBe(2026);
    });

    it(`${league}: February → current year (preliminary rounds)`, () => {
      expect(currentSeason(league, new Date("2026-02-01T00:00:00Z"))).toBe(2026);
    });

    it(`${league}: November → current year (final)`, () => {
      expect(currentSeason(league, new Date("2026-11-28T20:00:00Z"))).toBe(2026);
    });
  }
});

describe("currentSeason — World Cup (single edition)", () => {
  // The 2026 tournament is keyed on season 2026 by both providers, regardless
  // of the instant queried.
  it("returns 2026 in June (tournament month)", () => {
    expect(currentSeason("world_cup", new Date("2026-06-11T12:00:00Z"))).toBe(
      2026,
    );
  });

  it("returns 2026 regardless of the date", () => {
    expect(currentSeason("world_cup", new Date("2026-01-01T00:00:00Z"))).toBe(
      2026,
    );
    expect(currentSeason("world_cup", new Date("2026-12-31T23:59:59Z"))).toBe(
      2026,
    );
  });
});

describe("SupportedLeague type", () => {
  it("widens narrow string literals correctly", () => {
    const value: SupportedLeague = "brasileirao_a";
    expect(SUPPORTED_LEAGUES).toContain(value);
  });
});

describe("currentSeason — European domestic leagues (cross-year, like UCL)", () => {
  const leagues: SupportedLeague[] = ["serie_a", "bundesliga", "ligue_1"];

  it("September → current year (2026/27 season)", () => {
    for (const l of leagues) {
      expect(currentSeason(l, new Date("2026-09-24T12:00:00Z"))).toBe(2026);
    }
  });

  it("May → previous year (season ending)", () => {
    for (const l of leagues) {
      expect(currentSeason(l, new Date("2027-05-20T12:00:00Z"))).toBe(2026);
    }
  });
});
