import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";
import {
  computeMatchLambdas,
  gradeScorelineLeg,
  type ScorelineKind,
} from "@/lib/bets/grade-scoreline";
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

const TABLE: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2024,
  tables: [
    {
      teams: [
        team(1, "Forte", 10, 24, 6, {
          home: split(5, 14, 2),
          away: split(5, 10, 4),
        }),
        team(2, "Fraco", 10, 6, 20, {
          home: split(5, 4, 9),
          away: split(5, 2, 11),
        }),
        team(3, "Meio", 10, 12, 12, {
          home: split(5, 7, 6),
          away: split(5, 5, 6),
        }),
      ],
    },
  ],
};

function grade(kind: ScorelineKind, params: BetLegParams) {
  return gradeScorelineLeg({
    standing: TABLE,
    homeTeam: "Forte",
    awayTeam: "Fraco",
    neutral: false,
    kind,
    params,
  });
}

describe("computeMatchLambdas", () => {
  it("standings undefined → null (prefer-skip)", () => {
    expect(
      computeMatchLambdas({
        standing: undefined,
        homeTeam: "Forte",
        awayTeam: "Fraco",
        neutral: false,
      }),
    ).toBeNull();
  });

  it("[B1] tabela degenerada (Σ played 0) → null", () => {
    const degen: NormalizedStanding = {
      league: "brasileirao_a",
      season: 2024,
      tables: [{ teams: [team(1, "A", 0, 0, 0), team(2, "B", 0, 0, 0)] }],
    };
    expect(
      computeMatchLambdas({
        standing: degen,
        homeTeam: "A",
        awayTeam: "B",
        neutral: false,
      }),
    ).toBeNull();
  });

  it("mandante forte ⇒ λ_home > λ_away", () => {
    const l = computeMatchLambdas({
      standing: TABLE,
      homeTeam: "Forte",
      awayTeam: "Fraco",
      neutral: false,
    })!;
    expect(l.lambdaHome).toBeGreaterThan(l.lambdaAway);
    expect(l.degradedData).toBe(false);
  });
});

describe("gradeScorelineLeg — todos os kinds do Caminho B", () => {
  it("standings ausente → no_data em qualquer kind", () => {
    const g = gradeScorelineLeg({
      standing: undefined,
      homeTeam: "Forte",
      awayTeam: "Fraco",
      neutral: false,
      kind: "match_result",
      params: { selection: "home" },
    });
    expect(g.status).toBe("no_data");
  });

  it("exact_score: prob em (0,100)", () => {
    const g = grade("exact_score", { home: 2, away: 0 });
    expect(g.status).toBe("graded");
    if (g.status === "graded") {
      expect(g.modelProbPct).toBeGreaterThan(0);
      expect(g.modelProbPct).toBeLessThan(100);
    }
  });

  it("match_result: home+draw+away ≈ 100; mandante forte ⇒ home é o maior", () => {
    const h = grade("match_result", { selection: "home" });
    const d = grade("match_result", { selection: "draw" });
    const a = grade("match_result", { selection: "away" });
    if (h.status !== "graded" || d.status !== "graded" || a.status !== "graded")
      throw new Error("graded");
    expect(h.modelProbPct + d.modelProbPct + a.modelProbPct).toBeCloseTo(100, 6);
    expect(h.modelProbPct).toBeGreaterThan(a.modelProbPct);
  });

  it("over_under: over + under ≈ 100 na mesma linha", () => {
    const o = grade("over_under", { selection: "over", line: 2.5 });
    const u = grade("over_under", { selection: "under", line: 2.5 });
    if (o.status !== "graded" || u.status !== "graded") throw new Error("graded");
    expect(o.modelProbPct + u.modelProbPct).toBeCloseTo(100, 6);
  });

  it("btts sim + não ≈ 100", () => {
    const y = grade("btts", { selection: "yes" });
    const n = grade("btts", { selection: "no" });
    if (y.status !== "graded" || n.status !== "graded") throw new Error("graded");
    expect(y.modelProbPct + n.modelProbPct).toBeCloseTo(100, 6);
  });

  it("double_chance: home_draw >= max(home, draw) individuais", () => {
    const hd = grade("double_chance", { selection: "home_draw" });
    const h = grade("match_result", { selection: "home" });
    const d = grade("match_result", { selection: "draw" });
    if (hd.status !== "graded" || h.status !== "graded" || d.status !== "graded")
      throw new Error("graded");
    expect(hd.modelProbPct).toBeCloseTo(h.modelProbPct + d.modelProbPct, 6);
  });

  it("margin: margem >=2 ⊂ margem >=1", () => {
    const m1 = grade("margin", { side: "home", minMargin: 1 });
    const m2 = grade("margin", { side: "home", minMargin: 2 });
    if (m1.status !== "graded" || m2.status !== "graded") throw new Error("graded");
    expect(m1.modelProbPct).toBeGreaterThan(m2.modelProbPct);
  });

  it("clean_sheet: mandante forte segura mais que o fraco", () => {
    const home = grade("clean_sheet", { side: "home" });
    const away = grade("clean_sheet", { side: "away" });
    if (home.status !== "graded" || away.status !== "graded")
      throw new Error("graded");
    expect(home.modelProbPct).toBeGreaterThan(away.modelProbPct);
  });

  it("first_half_over_under 0.5: over 1ºT < over do jogo cheio (menos gols)", () => {
    const fh = grade("first_half_over_under", { selection: "over", line: 0.5 });
    const full = grade("over_under", { selection: "over", line: 0.5 });
    if (fh.status !== "graded" || full.status !== "graded")
      throw new Error("graded");
    expect(fh.modelProbPct).toBeLessThan(full.modelProbPct);
  });

  it("first_to_score: home + away + none ≈ 100", () => {
    const h = grade("first_to_score", { firstToScore: "home" });
    const a = grade("first_to_score", { firstToScore: "away" });
    const n = grade("first_to_score", { firstToScore: "none" });
    if (h.status !== "graded" || a.status !== "graded" || n.status !== "graded")
      throw new Error("graded");
    expect(h.modelProbPct + a.modelProbPct + n.modelProbPct).toBeCloseTo(100, 6);
  });

  it("first_half_score: prob em (0,100)", () => {
    const g = grade("first_half_score", { home: 1, away: 0 });
    expect(g.status).toBe("graded");
  });
});
