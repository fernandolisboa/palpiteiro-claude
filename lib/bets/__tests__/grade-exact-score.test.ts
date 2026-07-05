import { describe, expect, it } from "vitest";

import { gradeExactScoreFromStandings } from "@/lib/bets/grade-exact-score";
import type {
  NormalizedStanding,
  NormalizedStandingSplit,
  NormalizedStandingTeam,
} from "@/lib/providers/sports-data/types";

function split(
  played: number,
  goalsFor: number,
  goalsAgainst: number,
): NormalizedStandingSplit {
  return { played, wins: 0, draws: 0, losses: 0, goalsFor, goalsAgainst };
}

function team(
  position: number,
  name: string,
  played: number,
  goalsFor: number,
  goalsAgainst: number,
  splits?: { home?: NormalizedStandingSplit; away?: NormalizedStandingSplit },
): NormalizedStandingTeam {
  return {
    position,
    team: name,
    played,
    won: 0,
    draw: 0,
    lost: 0,
    goalsFor,
    goalsAgainst,
    points: 0,
    homeSplit: splits?.home,
    awaySplit: splits?.away,
  };
}

function standing(teams: NormalizedStandingTeam[]): NormalizedStanding {
  return { league: "brasileirao_a", season: 2024, tables: [{ teams }] };
}

describe("gradeExactScoreFromStandings", () => {
  it("standings undefined → no_data (prefer-skip)", () => {
    const r = gradeExactScoreFromStandings({
      standing: undefined,
      homeTeam: "Palmeiras",
      awayTeam: "Corinthians",
      home: 2,
      away: 0,
      neutral: false,
    });
    expect(r.status).toBe("no_data");
  });

  it("[B1] tabela degenerada (Σ played = 0) → no_data, NUNCA λ fabricado", () => {
    const table = standing([
      team(1, "Palmeiras", 0, 0, 0, {
        home: split(0, 0, 0),
        away: split(0, 0, 0),
      }),
      team(2, "Corinthians", 0, 0, 0, {
        home: split(0, 0, 0),
        away: split(0, 0, 0),
      }),
    ]);
    const r = gradeExactScoreFromStandings({
      standing: table,
      homeTeam: "Palmeiras",
      awayTeam: "Corinthians",
      home: 1,
      away: 0,
      neutral: false,
    });
    expect(r.status).toBe("no_data");
  });

  it("splits usáveis nos dois → graded, prob em (0,100), degradedData false", () => {
    const table = standing([
      team(1, "Palmeiras", 10, 20, 8, {
        home: split(5, 12, 3),
        away: split(5, 8, 5),
      }),
      team(2, "Corinthians", 10, 10, 14, {
        home: split(5, 6, 6),
        away: split(5, 4, 8),
      }),
      team(3, "Outro", 10, 12, 12, {
        home: split(5, 7, 6),
        away: split(5, 5, 6),
      }),
    ]);
    const r = gradeExactScoreFromStandings({
      standing: table,
      homeTeam: "Palmeiras",
      awayTeam: "Corinthians",
      home: 2,
      away: 0,
      neutral: false,
    });
    expect(r.status).toBe("graded");
    if (r.status !== "graded") return;
    expect(r.modelProbPct).toBeGreaterThan(0);
    expect(r.modelProbPct).toBeLessThan(100);
    expect(r.degradedData).toBe(false);
  });

  it("times sem split (mas liga com jogos) → prior, degradedData true", () => {
    const table = standing([
      team(1, "Palmeiras", 10, 20, 8),
      team(2, "Corinthians", 10, 10, 14),
    ]);
    const r = gradeExactScoreFromStandings({
      standing: table,
      homeTeam: "Palmeiras",
      awayTeam: "Corinthians",
      home: 1,
      away: 1,
      neutral: false,
    });
    expect(r.status).toBe("graded");
    if (r.status !== "graded") return;
    expect(r.degradedData).toBe(true);
  });

  it("time fora da tabela → split ausente → prior (degradedData true)", () => {
    const table = standing([
      team(1, "Palmeiras", 10, 20, 8, {
        home: split(5, 12, 3),
        away: split(5, 8, 5),
      }),
    ]);
    const r = gradeExactScoreFromStandings({
      standing: table,
      homeTeam: "Palmeiras",
      awayTeam: "Time Inexistente",
      home: 2,
      away: 1,
      neutral: false,
    });
    expect(r.status).toBe("graded");
    if (r.status !== "graded") return;
    expect(r.degradedData).toBe(true);
  });
});
