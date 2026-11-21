import { describe, expect, it } from "vitest";

import { applyJudgments } from "@/lib/ai/judgments/apply";
import { inPlayScoreline, remainingFraction } from "@/lib/quant/in-play";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { p1X2, poissonPmf, scorelineMatrix } from "@/lib/quant/scoreline-model";
import {
  computeScenarios,
  favoriteRedFrom60,
  favoriteWeakenedMax,
  leadAt30,
} from "@/lib/underdog/scenarios";

import { answers } from "./fixtures";

function pre(lh: number, la: number, rho = -0.1): ModelScoreline {
  return {
    source: "dixon_coles",
    degraded: false,
    lambdaHome: lh,
    lambdaAway: la,
    rho,
    matrix: scorelineMatrix(lh, la, { rho }),
  };
}

const dogPct = (m: ModelScoreline, side: "home" | "away") =>
  p1X2(m.matrix)[side] * 100;

// Mistura sobre o placar aos 60' pelo modelo em jogo (a referência do cenário B).
function mixtureAt60(
  model: ModelScoreline,
  side: "home" | "away",
  red: { home: number; away: number } | null
): number {
  const f = remainingFraction({ statusShort: "2H", elapsed: 60, extra: null });
  if (!f.ok) throw new Error("r60");
  const played = 1 - f.r;
  let acc = 0;
  let mass = 0;
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p =
        poissonPmf(h, model.lambdaHome * played) *
        poissonPmf(a, model.lambdaAway * played);
      if (p < 1e-5) continue;
      const live = inPlayScoreline(model, {
        statusShort: "2H",
        elapsed: 60,
        extra: null,
        score: { home: h, away: a },
        red,
      });
      if (!live) continue;
      acc += p * p1X2(live.matrix)[side];
      mass += p;
    }
  }
  return (acc / mass) * 100;
}

describe("cenário A: azarão vencendo por 1 × 0 aos 30'", () => {
  it("sobe a chance", () => {
    const m = pre(1.4, 1.0);
    expect(leadAt30(m, "away")!).toBeGreaterThan(dogPct(m, "away") + 15);
  });
});

describe("cenário B: favorito com um a menos desde os 60' (forma fechada)", () => {
  it.each([
    [1.4, 1.0],
    [2.1, 0.7],
    [1.1, 1.6],
    [0.9, 0.6],
  ])(
    "λ %s × %s: forma fechada ≈ mistura pelo modelo em jogo (±0,5 pp)",
    (lh, la) => {
      const m = pre(lh, la);
      const side = lh > la ? "away" : "home";
      const fav = side === "home" ? "away" : "home";
      const red = fav === "home" ? { home: 1, away: 0 } : { home: 0, away: 1 };
      expect(
        Math.abs(favoriteRedFrom60(m, side)! - mixtureAt60(m, side, red))
      ).toBeLessThan(0.5);
    }
  );

  it("a mesma mistura sem cartão fica a ±1 pp do pré-jogo", () => {
    for (const [lh, la] of [
      [1.4, 1.0],
      [2.1, 0.7],
    ]) {
      const m = pre(lh, la);
      expect(
        Math.abs(mixtureAt60(m, "away", null) - dogPct(m, "away"))
      ).toBeLessThan(1);
    }
  });

  it("cartão no favorito sobe a chance do azarão", () => {
    const m = pre(1.4, 1.0);
    expect(favoriteRedFrom60(m, "away")!).toBeGreaterThan(dogPct(m, "away"));
  });
});

describe("cenário C: favorito desfalcado e com rodízio no máximo", () => {
  it("usa applyJudgments sobre o λ base com os fatores do favorito em 1", () => {
    const got = favoriteWeakenedMax({
      lambdaHomeBase: 1.4,
      lambdaAwayBase: 1.0,
      rho: -0.1,
      answers: null,
      side: "away",
    })!;
    const a = answers({
      attack_weakened_home: 1,
      defense_weakened_home: 1,
      rotation_risk_home: 1,
      attack_weakened_away: 0,
      defense_weakened_away: 0,
      rotation_risk_away: 0,
      high_stakes_home: 0,
      high_stakes_away: 0,
    });
    const adj = applyJudgments({ lambdaHome: 1.4, lambdaAway: 1.0 }, a);
    const expected =
      p1X2(scorelineMatrix(adj.lambdaHome, adj.lambdaAway, { rho: -0.1 }))
        .away * 100;
    expect(got).toBeCloseTo(expected, 10);
    expect(got).toBeGreaterThan(
      p1X2(scorelineMatrix(1.4, 1.0, { rho: -0.1 })).away * 100
    );
  });

  it("pulado quando o JEV da base já está no máximo (Δ < 1 pp)", () => {
    const stored = answers({
      attack_weakened_home: 1,
      defense_weakened_home: 1,
      rotation_risk_home: 1,
    });
    const post = applyJudgments({ lambdaHome: 1.4, lambdaAway: 1.0 }, stored);
    const out = computeScenarios({
      pre: pre(post.lambdaHome, post.lambdaAway),
      side: "away",
      lambdaHomeBase: 1.4,
      lambdaAwayBase: 1.0,
      answers: stored,
    });
    expect(out.map((s) => s.id)).not.toContain("absences_max");
  });
});

describe("computeScenarios", () => {
  it("os três, na ordem, com antes = chance do azarão e 1 casa", () => {
    const m = pre(1.4, 1.0);
    const out = computeScenarios({
      pre: m,
      side: "away",
      lambdaHomeBase: 1.4,
      lambdaAwayBase: 1.0,
      answers: null,
    });
    expect(out.map((s) => s.id)).toEqual(["lead_30", "red_60", "absences_max"]);
    const before = Math.round(dogPct(m, "away") * 10) / 10;
    expect(out.every((s) => s.beforePct === before)).toBe(true);
    expect(out.every((s) => s.afterPct > s.beforePct)).toBe(true);
  });

  it("simetria casa/fora e determinismo", () => {
    const away = computeScenarios({
      pre: pre(1.4, 1.0),
      side: "away",
      lambdaHomeBase: 1.4,
      lambdaAwayBase: 1.0,
      answers: null,
    });
    const home = computeScenarios({
      pre: pre(1.0, 1.4),
      side: "home",
      lambdaHomeBase: 1.0,
      lambdaAwayBase: 1.4,
      answers: null,
    });
    expect(home).toEqual(away);
    expect(
      computeScenarios({
        pre: pre(1.4, 1.0),
        side: "away",
        lambdaHomeBase: 1.4,
        lambdaAwayBase: 1.0,
        answers: null,
      })
    ).toEqual(away);
  });

  it("Δ < 1 pp sai", () => {
    // λ base tal que o máximo do JEV (favorito × 0,94 × 0,95, azarão × 1,06) reproduz o
    // λ da base: o cenário C não muda nada.
    const m = pre(1.4, 1.0);
    const out = computeScenarios({
      pre: m,
      side: "away",
      lambdaHomeBase: 1.4 / (0.94 * 0.95),
      lambdaAwayBase: 1.0 / 1.06,
      answers: null,
    });
    expect(out.map((s) => s.id)).not.toContain("absences_max");
  });
});
