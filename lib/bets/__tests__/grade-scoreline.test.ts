import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";
import {
  computeMatchLambdas,
  computeSlipJoint,
  gradeScorelineLeg,
  legToScorePredicate,
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

// ── legToScorePredicate: cada predicado ESPELHA o reader (mesma medida) ───────
describe("legToScorePredicate", () => {
  it("kinds fora da matriz → null (derrubam a combinada)", () => {
    expect(legToScorePredicate("first_half_score", { home: 1, away: 0 })).toBeNull();
    expect(
      legToScorePredicate("first_half_over_under", { selection: "over", line: 0.5 }),
    ).toBeNull();
    expect(legToScorePredicate("first_to_score", { firstToScore: "home" })).toBeNull();
    expect(legToScorePredicate("cards", { selection: "over", line: 3.5 })).toBeNull();
    expect(legToScorePredicate("corners", { selection: "over", line: 8.5 })).toBeNull();
  });

  it("cada predicado da matriz bate a marginal do reader (grade)", () => {
    // Pra cada kind de placar, joint([pred]) sobre a matriz do slip == modelProbPct
    // do gradeScorelineLeg da mesma perna (o predicado é a MESMA soma do reader).
    const cases: Array<[ScorelineKind, BetLegParams]> = [
      ["exact_score", { home: 2, away: 0 }],
      ["margin", { side: "home", minMargin: 2 }],
      ["clean_sheet", { side: "home" }],
      ["over_under", { selection: "over", line: 2.5 }],
      ["over_under", { selection: "under", line: 2.5 }],
      ["match_result", { selection: "home" }],
      ["match_result", { selection: "draw" }],
      ["match_result", { selection: "away" }],
      ["btts", { selection: "yes" }],
      ["btts", { selection: "no" }],
      ["double_chance", { selection: "home_draw" }],
      ["double_chance", { selection: "home_away" }],
      ["double_chance", { selection: "draw_away" }],
    ];
    for (const [kind, params] of cases) {
      const g = grade(kind, params);
      const joint = computeSlipJoint({
        standing: TABLE,
        homeTeam: "Forte",
        awayTeam: "Fraco",
        neutral: false,
        legs: [{ kind, params }],
      });
      if (g.status !== "graded" || joint === null)
        throw new Error(`graded/joint ${kind}`);
      expect(joint.jointProbPct).toBeCloseTo(g.modelProbPct, 6);
      expect(joint.marginalsPct[0]).toBeCloseTo(g.modelProbPct, 6);
    }
  });
});

describe("computeSlipJoint (combinada same-game)", () => {
  const slipJoint = (legs: Array<{ kind: string; params: BetLegParams }>) =>
    computeSlipJoint({
      standing: TABLE,
      homeTeam: "Forte",
      awayTeam: "Fraco",
      neutral: false,
      legs,
    });

  it("standings ausente → null (combinada não avaliada)", () => {
    expect(
      computeSlipJoint({
        standing: undefined,
        homeTeam: "Forte",
        awayTeam: "Fraco",
        neutral: false,
        legs: [{ kind: "match_result", params: { selection: "home" } }],
      }),
    ).toBeNull();
  });

  it("qualquer perna fora da matriz → null", () => {
    expect(
      slipJoint([
        { kind: "match_result", params: { selection: "home" } },
        { kind: "first_to_score", params: { firstToScore: "home" } },
      ]),
    ).toBeNull();
  });

  it("joint ≤ min(marginais) — invariante de coerência de tela", () => {
    const j = slipJoint([
      { kind: "match_result", params: { selection: "home" } },
      { kind: "over_under", params: { selection: "over", line: 1.5 } },
    ]);
    if (j === null) throw new Error("joint");
    expect(j.jointProbPct).toBeLessThanOrEqual(Math.min(...j.marginalsPct) + 1e-9);
  });

  it("joint(super-conjunto) ≤ joint(sub-conjunto) — monotonicidade", () => {
    const sub = slipJoint([
      { kind: "match_result", params: { selection: "home" } },
    ]);
    const sup = slipJoint([
      { kind: "match_result", params: { selection: "home" } },
      { kind: "over_under", params: { selection: "over", line: 2.5 } },
    ]);
    if (sub === null || sup === null) throw new Error("joint");
    expect(sup.jointProbPct).toBeLessThanOrEqual(sub.jointProbPct + 1e-9);
  });

  // PINADO (Decisão 4 / Consequência "armadilha de correlação"): a conjunta NUNCA é o
  // produto das marginais. Mandante-forte vence e over são POSITIVAMENTE correlacionados
  // (mais gols do mandante empurra os dois) → joint > produto. O teste trava qualquer
  // regressão pra multiplicação ingênua de probs de pernas do mesmo jogo.
  it("NUNCA multiplica: joint ≠ produto das marginais (correlação)", () => {
    const j = slipJoint([
      { kind: "match_result", params: { selection: "home" } },
      { kind: "over_under", params: { selection: "over", line: 2.5 } },
    ]);
    if (j === null) throw new Error("joint");
    const product = (j.marginalsPct[0] / 100) * (j.marginalsPct[1] / 100) * 100;
    expect(j.jointProbPct).not.toBeCloseTo(product, 2);
    // Correlação positiva ⇒ joint estritamente acima do produto (independência).
    expect(j.jointProbPct).toBeGreaterThan(product);
  });
});
