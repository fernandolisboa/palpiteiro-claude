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

describe("FOOTBALL_DATA_ORG_TEAM_IDS coverage", () => {
  it("covers every canonical team in every league", () => {
    for (const league of SUPPORTED_LEAGUES) {
      const map = FOOTBALL_DATA_ORG_TEAM_IDS[league];
      const missing = CANONICAL_TEAMS[league].filter(
        (name) => !(name in map),
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

describe("API_FOOTBALL_TEAM_IDS coverage (account suspended)", () => {
  // The api-football map is intentionally empty until the account is
  // reactivated. Once `pnpm tsx scripts/generate-team-ids.ts
  // --provider=api-football` is run, flip these expectations to enforce
  // full coverage (mirror the football-data-org tests above).
  it("is currently empty per intentional stub", () => {
    for (const league of SUPPORTED_LEAGUES) {
      expect(Object.keys(API_FOOTBALL_TEAM_IDS[league]).length).toBe(0);
    }
  });
});
