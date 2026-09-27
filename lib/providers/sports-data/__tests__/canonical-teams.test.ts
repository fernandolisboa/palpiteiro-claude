import { describe, expect, it } from "vitest";

import { API_FOOTBALL_TEAM_IDS } from "@/lib/providers/sports-data/api-football/team-ids";
import {
  CANONICAL_TEAMS,
  isCanonicalTeam,
} from "@/lib/providers/sports-data/canonical-teams";
import { FOOTBALL_DATA_ORG_TEAM_IDS } from "@/lib/providers/sports-data/football-data-org/team-ids";
import {
  FOOTBALL_DATA_ORG_LEAGUE_CODES,
  RUNTIME_TEAM_ID_LEAGUES,
  SUPPORTED_LEAGUES,
} from "@/lib/providers/sports-data/leagues";
import { canonicalizeTeamName } from "@/lib/providers/sports-data/team-names";
import { teamsMatch } from "@/lib/odds/market-descriptor";

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
    expect(isCanonicalTeam("Definitely Not A Team", "brasileirao_a")).toBe(
      false
    );
  });
});

// Lacuna conhecida e explícita (ADR 0049 §3): id do football-data não confirmado
// sem key. A API-Football (primária) cobre o time; fecha ao rodar
// scripts/generate-team-ids.ts --provider=football-data-org.
const FOOTBALL_DATA_ORG_KNOWN_GAPS: Partial<Record<string, readonly string[]>> =
  {
    la_liga: ["Racing Santander"],
  };

describe("FOOTBALL_DATA_ORG_TEAM_IDS coverage", () => {
  // Only leagues football-data.org serves (the CONMEBOL cups aren't on its free
  // tier — ADR 0045); API-Football covers every league below.
  it("covers every canonical team in every league it serves", () => {
    for (const league of SUPPORTED_LEAGUES) {
      if (!FOOTBALL_DATA_ORG_LEAGUE_CODES[league]) continue;
      const map = FOOTBALL_DATA_ORG_TEAM_IDS[league];
      const gaps = FOOTBALL_DATA_ORG_KNOWN_GAPS[league] ?? [];
      const missing = CANONICAL_TEAMS[league].filter(
        (name) => !(name in map) && !gaps.includes(name)
      );
      expect(missing, `football-data-org missing teams in ${league}`).toEqual(
        []
      );
    }
  });

  it("all IDs are positive integers", () => {
    for (const league of SUPPORTED_LEAGUES) {
      for (const [name, id] of Object.entries(
        FOOTBALL_DATA_ORG_TEAM_IDS[league]
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
      // Copas: ids resolvidos em runtime via /teams (ADR 0045, emenda 2026-09-27).
      if (RUNTIME_TEAM_ID_LEAGUES.has(league)) continue;
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

// Semifinalistas da Libertadores 2026 (ADR 0045, emenda 2026-09-27): a grafia
// canônica precisa casar os dois lados — a API-Football (fixtures, /teams) e a
// The Odds API (pareamento de odds por teamsMatch). Nomes da The Odds API
// conferidos em /v4/sports/soccer_conmebol_copa_libertadores/events.
describe("Copa Libertadores — grafia dos semifinalistas", () => {
  const cases: ReadonlyArray<{
    canonical: string;
    apiFootball: string;
    oddsApi: string;
  }> = [
    { canonical: "Flamengo", apiFootball: "Flamengo", oddsApi: "Flamengo-RJ" },
    {
      canonical: "Palmeiras",
      apiFootball: "Palmeiras",
      oddsApi: "Palmeiras-SP",
    },
    {
      canonical: "Fluminense",
      apiFootball: "Fluminense",
      oddsApi: "Fluminense-RJ",
    },
    {
      canonical: "Estudiantes de La Plata",
      apiFootball: "Estudiantes L.P.",
      oddsApi: "Estudiantes La Plata",
    },
  ];

  it.each(cases)(
    "$canonical: API-Football canonicaliza e The Odds API pareia",
    ({ canonical, apiFootball, oddsApi }) => {
      expect(isCanonicalTeam(canonical, "copa_libertadores")).toBe(true);
      expect(canonicalizeTeamName(apiFootball, "copa_libertadores")).toBe(
        canonical
      );
      expect(teamsMatch(oddsApi, canonical)).toBe(true);
    }
  );

  it("nenhum semifinalista pareia com o nome da The Odds API de outro", () => {
    for (const a of cases) {
      for (const b of cases) {
        if (a === b) continue;
        expect(
          teamsMatch(b.oddsApi, a.canonical),
          `${b.oddsApi} x ${a.canonical}`
        ).toBe(false);
      }
    }
  });
});
