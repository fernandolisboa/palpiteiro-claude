import { describe, expect, it } from "vitest";

import { API_FOOTBALL_TEAM_IDS } from "@/lib/providers/sports-data/api-football/team-ids";
import {
  CANONICAL_TEAMS,
  isCanonicalTeam,
} from "@/lib/providers/sports-data/canonical-teams";
import { FOOTBALL_DATA_ORG_TEAM_IDS } from "@/lib/providers/sports-data/football-data-org/team-ids";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";

describe("CANONICAL_TEAMS", () => {
  it("has 20 Brasileirão teams", () => {
    expect(CANONICAL_TEAMS.brasileirao_a.length).toBe(20);
  });

  it("has at least 32 Champions League teams (group/league stage)", () => {
    expect(CANONICAL_TEAMS.champions_league.length).toBeGreaterThanOrEqual(32);
  });

  it("has 48 World Cup national teams (2026 format)", () => {
    expect(CANONICAL_TEAMS.world_cup.length).toBe(48);
  });

  it("has 20 Premier League and 20 La Liga teams (2026/27)", () => {
    expect(CANONICAL_TEAMS.premier_league.length).toBe(20);
    expect(CANONICAL_TEAMS.la_liga.length).toBe(20);
  });

  it("names are non-empty and unique within each league", () => {
    for (const league of SUPPORTED_LEAGUES) {
      const names = CANONICAL_TEAMS[league];
      for (const n of names) expect(n.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("isCanonicalTeam discriminates correctly", () => {
    const first = CANONICAL_TEAMS.brasileirao_a[0];
    expect(first).toBeDefined();
    expect(isCanonicalTeam(first!, "brasileirao_a")).toBe(true);
    expect(isCanonicalTeam("Definitely Not A Team", "brasileirao_a")).toBe(false);
  });
});

// Lacuna conhecida e explícita (ADR 0045 §3): id do football-data não confirmado
// sem key. A API-Football (primária) cobre o time; fecha ao rodar
// scripts/generate-team-ids.ts --provider=football-data-org.
const FOOTBALL_DATA_ORG_KNOWN_GAPS: Partial<Record<string, readonly string[]>> = {
  la_liga: ["Racing Santander"],
};

describe("FOOTBALL_DATA_ORG_TEAM_IDS coverage", () => {
  it("covers every canonical team in every league", () => {
    for (const league of SUPPORTED_LEAGUES) {
      const map = FOOTBALL_DATA_ORG_TEAM_IDS[league];
      const gaps = FOOTBALL_DATA_ORG_KNOWN_GAPS[league] ?? [];
      const missing = CANONICAL_TEAMS[league].filter(
        (name) => !(name in map) && !gaps.includes(name),
      );
      expect(missing, `football-data-org missing teams in ${league}`).toEqual(
        [],
      );
    }
  });

  it("all IDs are positive integers", () => {
    for (const league of SUPPORTED_LEAGUES) {
      for (const [name, id] of Object.entries(
        FOOTBALL_DATA_ORG_TEAM_IDS[league],
      )) {
        expect(Number.isInteger(id), `${league} ${name}`).toBe(true);
        expect(id).toBeGreaterThan(0);
      }
    }
  });
});

describe("API_FOOTBALL_TEAM_IDS coverage", () => {
  // The account is reactivated (issue #29), so the api-football map must cover
  // every canonical team in every league — same contract as football-data-org.
  it("covers every canonical team in every league", () => {
    for (const league of SUPPORTED_LEAGUES) {
      const map = API_FOOTBALL_TEAM_IDS[league];
      const missing = CANONICAL_TEAMS[league].filter((name) => !(name in map));
      expect(missing, `api-football missing teams in ${league}`).toEqual([]);
    }
  });

  it("all IDs are positive integers", () => {
    for (const league of SUPPORTED_LEAGUES) {
      for (const [name, id] of Object.entries(API_FOOTBALL_TEAM_IDS[league])) {
        expect(Number.isInteger(id), `${league} ${name}`).toBe(true);
        expect(id).toBeGreaterThan(0);
      }
    }
  });
});
