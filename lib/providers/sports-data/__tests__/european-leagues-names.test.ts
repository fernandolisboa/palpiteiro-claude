import { describe, expect, it } from "vitest";

import { teamsMatch } from "@/lib/odds/market-descriptor";
import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";
import { canonicalizeTeamName } from "@/lib/providers/sports-data/team-names";

// Nomes como a API-Football os devolve (2026/27) → canônico esperado. Pina os
// aliases de team-names.ts e o fuzzy match (ADR 0045).
const API_FOOTBALL_NAMES = {
  premier_league: {
    Arsenal: "Arsenal FC",
    "Aston Villa": "Aston Villa FC",
    Bournemouth: "AFC Bournemouth",
    Brentford: "Brentford FC",
    Brighton: "Brighton & Hove Albion FC",
    Chelsea: "Chelsea FC",
    Coventry: "Coventry City FC",
    "Crystal Palace": "Crystal Palace FC",
    Everton: "Everton FC",
    Fulham: "Fulham FC",
    "Hull City": "Hull City AFC",
    Ipswich: "Ipswich Town FC",
    Leeds: "Leeds United FC",
    Liverpool: "Liverpool FC",
    "Manchester City": "Manchester City FC",
    "Manchester United": "Manchester United FC",
    Newcastle: "Newcastle United FC",
    "Nottingham Forest": "Nottingham Forest FC",
    Sunderland: "Sunderland AFC",
    Tottenham: "Tottenham Hotspur FC",
  },
  la_liga: {
    Alaves: "Deportivo Alavés",
    "Athletic Club": "Athletic Club",
    "Atletico Madrid": "Club Atlético de Madrid",
    Barcelona: "FC Barcelona",
    "Celta Vigo": "RC Celta de Vigo",
    "Deportivo La Coruna": "RC Deportivo La Coruña",
    Elche: "Elche CF",
    Espanyol: "RCD Espanyol",
    Getafe: "Getafe CF",
    Levante: "Levante UD",
    Malaga: "Málaga CF",
    Osasuna: "CA Osasuna",
    "Racing Santander": "Racing Santander",
    "Rayo Vallecano": "Rayo Vallecano",
    "Real Betis": "Real Betis Balompié",
    "Real Madrid": "Real Madrid CF",
    "Real Sociedad": "Real Sociedad de Fútbol",
    Sevilla: "Sevilla FC",
    Valencia: "Valencia CF",
    Villarreal: "Villarreal CF",
  },
} as const;

// Nomes como a The Odds API os escreve (soccer_epl / soccer_spain_la_liga).
// Não validados ao vivo (sem ODDS_API_KEY no ambiente de CI) — ADR 0045 §4.
const ODDS_API_NAMES = {
  premier_league: [
    "Arsenal", "Aston Villa", "Bournemouth", "Brentford",
    "Brighton and Hove Albion", "Chelsea", "Coventry City", "Crystal Palace",
    "Everton", "Fulham", "Hull City", "Ipswich Town", "Leeds United", "Liverpool",
    "Manchester City", "Manchester United", "Newcastle United",
    "Nottingham Forest", "Sunderland", "Tottenham Hotspur",
  ],
  la_liga: [
    "Alavés", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Celta Vigo",
    "Deportivo La Coruña", "Elche CF", "Espanyol", "Getafe", "Levante",
    "Málaga", "Osasuna", "Racing Santander", "Rayo Vallecano", "Real Betis",
    "Real Madrid", "Real Sociedad", "Sevilla", "Valencia", "Villarreal",
  ],
} as const;

const LEAGUES = ["premier_league", "la_liga"] as const;

describe("Premier League + La Liga team names (ADR 0045)", () => {
  for (const league of LEAGUES) {
    it(`${league}: every API-Football name canonicalizes`, () => {
      for (const [provider, canonical] of Object.entries(
        API_FOOTBALL_NAMES[league],
      )) {
        expect(canonicalizeTeamName(provider, league), provider).toBe(canonical);
      }
    });

    it(`${league}: every Odds API name matches exactly one canonical team`, () => {
      for (const oddsName of ODDS_API_NAMES[league]) {
        const hits = CANONICAL_TEAMS[league].filter((c) => teamsMatch(oddsName, c));
        expect(hits, oddsName).toHaveLength(1);
      }
    });

    it(`${league}: no two canonical teams match each other`, () => {
      const teams = CANONICAL_TEAMS[league];
      for (const a of teams) {
        const hits = teams.filter((b) => b !== a && teamsMatch(a, b));
        expect(hits, a).toEqual([]);
      }
    });
  }

  it("Madrid and Barcelona derbies resolve to the right side", () => {
    expect(teamsMatch("Atlético Madrid", "Real Madrid CF")).toBe(false);
    expect(teamsMatch("Atlético Madrid", "Rayo Vallecano")).toBe(false);
    expect(teamsMatch("Barcelona", "RCD Espanyol")).toBe(false);
    expect(teamsMatch("Athletic Bilbao", "Athletic Club")).toBe(true);
  });
});

describe("stopword change keeps existing leagues resolving (ADR 0045 §4)", () => {
  it("API-Football Brasileirão/Champions names with atletico/athletic still canonicalize", () => {
    expect(canonicalizeTeamName("Atletico Paranaense", "brasileirao_a")).toBe("CA Paranaense");
    expect(canonicalizeTeamName("Atletico-MG", "brasileirao_a")).toBe("CA Mineiro");
    expect(canonicalizeTeamName("Atletico Madrid", "champions_league")).toBe(
      "Club Atlético de Madrid",
    );
    expect(canonicalizeTeamName("Athletic Club", "champions_league")).toBe("Athletic Club");
  });

  it("Odds API Brasileirão names still match their canonical team", () => {
    expect(teamsMatch("Atletico Mineiro", "CA Mineiro")).toBe(true);
    expect(teamsMatch("Athletico Paranaense", "CA Paranaense")).toBe(true);
  });
});
