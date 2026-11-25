import { describe, expect, it, vi } from "vitest";

import type { FanOutOutcome } from "@/lib/ai/best-bet";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import type { Prediction } from "@/lib/ai/predict";
import { confidenceFromPick } from "@/lib/ai/palpites/confidence";
import {
  PALPITE_PICK_RULE,
  dcJevBaseFromAnalyses,
  marketBaseFromAnalyses,
  pickFromBase,
  resolvePregamePick,
  runJudgmentsFromAnalyses,
  type PalpiteBase,
  type PalpitePick,
} from "@/lib/ai/palpites/pick";
import { buildSettleablePalpiteRows } from "@/lib/ai/palpites/settleable-rows";
import {
  summarizeAnalysesForSynthesis,
  summarizeSavedAnalysesForSynthesis,
  type MarketAnalysisSummary,
} from "@/lib/ai/palpites/synthesis-input";
import type { WeighedInputs } from "@/lib/ai/palpites/weighed";
import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";
import { DIXON_COLES_RHO, scoreOutcome } from "@/lib/quant/scoreline-model";

import { NAO_VIRA, VIRA, codeJev, mr, ou } from "./weighed-fixtures";

const T0 = "2026-11-21T18:00:00.000Z";

function judgments(over: Partial<NonNullable<MarketAnalysisSummary["judgmentsModel"]>> = {}) {
  return {
    base: { home: 1.2, away: 1.4 },
    adjusted: { home: 1.2, away: 1.4 },
    rho: -0.08,
    stateHash: "state-1",
    jevAiCallId: "jev-1",
    ...over,
  };
}

function summary(over: Partial<MarketAnalysisSummary> = {}): MarketAnalysisSummary {
  return {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "home",
    recommendedLabel: "Casa",
    isPass: false,
    modelProbPct: 38,
    edgePct: 3.6,
    confidencePct: 38,
    oddAtRecommendation: 2.9,
    rationale: "",
    predictionId: "pred-mr",
    selections: [],
    engine: "code_jev",
    odds: { home: 2.9, draw: 3.3, away: 2.35 },
    line: null,
    predictionCreatedAt: T0,
    judgmentsModel: judgments(),
    factorPhrases: [],
    ...over,
  };
}

function overUnder(over: Partial<MarketAnalysisSummary> = {}): MarketAnalysisSummary {
  return summary({
    marketKey: "over_under",
    marketLabel: "Mais/Menos gols",
    recommendation: "over",
    predictionId: "pred-ou",
    odds: { over: 1.95, under: 1.9 },
    line: 2.5,
    ...over,
  });
}

describe("resolvePregamePick — regressão do #668 (Palmeiras x Flamengo)", () => {
  it("1X2 code_jev recomendando o mandante por valor com 2.90/3.30/2.35 → o palpite é o visitante", () => {
    const pick = resolvePregamePick([summary()]);
    expect(pick).not.toBeNull();
    expect(pick!.source).toBe("market");
    expect(pick!.outcome).toBe("away");
    expect(scoreOutcome(pick!.score)).toBe("away");
    expect(pick!.rule).toBe(PALPITE_PICK_RULE);
  });

  it("model_only com λ ajustado (0.95, 1.55) → visitante", () => {
    const pick = resolvePregamePick(
      [summary({ judgmentsModel: judgments({ adjusted: { home: 0.95, away: 1.55 } }) })],
      "model_only",
    );
    expect(pick!.source).toBe("dc_jev");
    expect(pick!.outcome).toBe("away");
  });

  it("dez chamadas iguais dão o mesmo palpite", () => {
    const analyses = [summary(), overUnder()];
    const first = resolvePregamePick(analyses);
    for (let i = 0; i < 10; i++) expect(resolvePregamePick(analyses)).toEqual(first);
  });
});

describe("prioridades das bases", () => {
  it("market_first: mercado quando o 1X2 tem as três odds", () => {
    expect(resolvePregamePick([summary()])!.source).toBe("market");
  });

  it("odd faltando ou inválida no 1X2 → cai pro λ do modelo", () => {
    const cases: Record<string, number>[] = [
      { home: 2.9, draw: 3.3 },
      { home: 2.9, draw: 1, away: 2.35 },
      {},
    ];
    for (const odds of cases) {
      const pick = resolvePregamePick([summary({ odds })]);
      expect(pick!.source).toBe("dc_jev");
    }
  });

  it("1X2 que o modelo não reproduz (1.7 / 8 / 2.5, empate baixo demais) → dc_jev", () => {
    const pick = resolvePregamePick([summary({ odds: { home: 1.7, draw: 8, away: 2.5 } })]);
    expect(pick!.source).toBe("dc_jev");
  });

  it("histórico sem rows de odds (odds vazio) → dc_jev (documentado, M3)", () => {
    expect(resolvePregamePick([summary({ odds: {} })])!.source).toBe("dc_jev");
  });

  it("sem 1X2 e sem λ → null (o v12 decide)", () => {
    expect(resolvePregamePick([summary({ marketKey: "btts", judgmentsModel: null })])).toBeNull();
    expect(resolvePregamePick([])).toBeNull();
  });

  it("1X2 sem julgamentos (motor LLM) ainda dá base de mercado, sem multiplicadores e com ρ pinado", () => {
    const base = marketBaseFromAnalyses([summary({ judgmentsModel: null })]);
    expect(base!.multipliers).toBeNull();
    expect(base!.rho).toBe(DIXON_COLES_RHO);
    expect(base!.lambda).toEqual(base!.base);
  });

  it("λ do run: match_result → double_chance → over_under → btts → qualquer, nunca a ordem de chegada", () => {
    const mk = (marketKey: string, home: number) =>
      summary({
        marketKey,
        predictionId: `p-${marketKey}`,
        judgmentsModel: judgments({ adjusted: { home, away: 1 } }),
      });
    const all = [mk("btts", 4), mk("over_under", 3), mk("double_chance", 2), mk("match_result", 1)];
    expect(runJudgmentsFromAnalyses(all)!.marketKey).toBe("match_result");
    expect(runJudgmentsFromAnalyses(all.slice(0, 3))!.marketKey).toBe("double_chance");
    expect(runJudgmentsFromAnalyses(all.slice(0, 2))!.marketKey).toBe("over_under");
    expect(runJudgmentsFromAnalyses([mk("zz_other", 9), mk("aa_other", 8)])!.marketKey).toBe(
      "aa_other",
    );
  });
});

describe("base de mercado", () => {
  it("multiplicadores = adjusted/base da MESMA predição; ρ dela", () => {
    const base = marketBaseFromAnalyses([
      summary({
        judgmentsModel: judgments({
          base: { home: 1.0, away: 1.5 },
          adjusted: { home: 0.9, away: 1.65 },
          rho: -0.05,
        }),
      }),
    ])!;
    expect(base.multipliers!.home).toBeCloseTo(0.9, 12);
    expect(base.multipliers!.away).toBeCloseTo(1.1, 12);
    expect(base.rho).toBe(-0.05);
    expect(base.lambda.home).toBeCloseTo(base.base.home * 0.9, 12);
    expect(base.basePredictionId).toBe("pred-mr");
    expect(base.predictionCreatedAt).toBe(T0);
  });

  it("over/under do mesmo run ancora o total; de outro run é ignorado", () => {
    const same = marketBaseFromAnalyses([summary(), overUnder()])!;
    expect(same.fit!.anchor).toBe("over_under");
    expect(same.fit!.overUnderPredictionId).toBe("pred-ou");

    const later = new Date(Date.parse(T0) + 30 * 60 * 1000).toISOString();
    const other = marketBaseFromAnalyses([summary(), overUnder({ predictionCreatedAt: later })])!;
    expect(other.fit!.anchor).toBe("draw");
    expect(other.fit!.overUnderPredictionId).toBeNull();

    const otherState = marketBaseFromAnalyses([
      summary(),
      overUnder({ judgmentsModel: judgments({ stateHash: "state-2" }) }),
    ])!;
    expect(otherState.fit!.anchor).toBe("draw");
  });

  it("invariante à ordem das análises (T3)", () => {
    const a = [summary(), overUnder(), summary({ marketKey: "btts", predictionId: "pb" })];
    const pick = resolvePregamePick(a);
    expect(resolvePregamePick([...a].reverse())).toEqual(pick);
    expect(resolvePregamePick([a[1], a[2], a[0]])).toEqual(pick);
  });
});

describe("base do modelo (dc_jev)", () => {
  it("reproduz judgments.lambda.adjusted exatamente (invariante)", () => {
    const j = judgments({ base: { home: 1.31, away: 0.97 }, adjusted: { home: 1.2445, away: 1.0185 } });
    const base = dcJevBaseFromAnalyses([summary({ odds: {}, judgmentsModel: j })])!;
    expect(base.lambda).toEqual(j.adjusted);
    const pick = pickFromBase(base)!;
    expect(pick.lambda).toEqual(j.adjusted);
    expect(pick.rho).toBe(j.rho);
    expect(pick.multipliers!.home).toBeCloseTo(1.2445 / 1.31, 12);
  });
});

describe("pickFromBase", () => {
  const base = (lambda: { home: number; away: number }): PalpiteBase => ({
    source: "dc_jev",
    base: lambda,
    multipliers: null,
    factors: null,
    lambda,
    rho: DIXON_COLES_RHO,
    basePredictionId: "p",
    predictionCreatedAt: null,
    fit: null,
  });

  it("λ inválido → null", () => {
    expect(pickFromBase(base({ home: 0, away: 1 }))).toBeNull();
    expect(pickFromBase(base({ home: Number.NaN, away: 1 }))).toBeNull();
  });

  it("propriedades com λ aleatório (T4)", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 200; i++) {
      const lambda = { home: 0.2 + rand() * 3.5, away: 0.2 + rand() * 3.5 };
      const pick = pickFromBase(base(lambda))!;
      expect(scoreOutcome(pick.score)).toBe(pick.outcome);
      // O resultado escolhido é o de maior chance (empate exato: ordem home → draw → away).
      const best = Math.max(pick.probs.home, pick.probs.draw, pick.probs.away);
      expect(pick.probs[pick.outcome]).toBeGreaterThanOrEqual(best - 0.01);
      expect(confidenceFromPick(pick).probPct).toBe(pick.probs[pick.outcome]);
      expect(pick.firstHalfScore.home).toBeLessThanOrEqual(pick.score.home);
      expect(pick.firstHalfScore.away).toBeLessThanOrEqual(pick.score.away);
      if (pick.outcome !== "draw") expect(pick.firstToScore).toBe(pick.outcome);
      if (pick.score.home + pick.score.away === 0) expect(pick.firstToScore).toBe("none");
      const rows = buildSettleablePalpiteRows("", {
        probableScore: pick.score,
        firstHalfScore: pick.firstHalfScore,
        firstToScore: pick.firstToScore,
      });
      const exact = rows.find((r) => r.type === "exact_score")!;
      expect(exact.params).toEqual(pick.score);
      expect(rows.some((r) => r.type === "first_half_score")).toBe(true);
      expect(pick.marginPp).toBeCloseTo(Math.abs(pick.probs.home - pick.probs.away), 1);
    }
  });

  it("jogo de poucos gols: empate 0–0 e ninguém marca primeiro", () => {
    const pick = pickFromBase(base({ home: 0.55, away: 0.6 }))!;
    expect(pick.outcome).toBe("draw");
    expect(pick.score).toEqual({ home: 0, away: 0 });
    expect(pick.firstHalfScore).toEqual({ home: 0, away: 0 });
    expect(pick.firstToScore).toBe("none");
  });
});

// ─── T2: paridade entre o run em memória e o histórico ───────────────────────

function prediction(over: Partial<Prediction>): Prediction {
  return {
    id: "pred-mr",
    recommendation: "home",
    edgePct: "3.60",
    confidencePct: "38.00",
    oddAtRecommendation: "2.900",
    rationale: "",
    modelVersion: "claude-haiku-5-5;engine=code_jev;lambda=dixon_coles",
    isLive: false,
    marketParams: null,
    createdAt: new Date(T0),
    judgments: {
      engine: "code_jev",
      applied: true,
      answers: null,
      multipliers: null,
      lambda: {
        source: "dixon_coles",
        degraded: false,
        rho: -0.08,
        base: { home: 1.2, away: 1.4 },
        adjusted: { home: 1.1, away: 1.45 },
      },
      versions: { judgments: "j", weights: "w", narrator: "n", jevModel: null },
      failure: null,
      stateHash: "state-1",
      aiCallId: "jev-1",
      reusedFromPredictionId: null,
    } satisfies PredictionJudgments,
    ...over,
  } as unknown as Prediction;
}

describe("paridade dos caminhos (T2)", () => {
  // Em memória a odd chega com a precisão do cálculo; o banco grava 3 casas.
  const memOdds = { home: 2.90049, draw: 3.2996, away: 2.35031 };
  const dbOdds = { home: 2.9, draw: 3.3, away: 2.35 };
  const ouMem = { over: 1.95012, under: 1.89977 };
  const ouDb = { over: 1.95, under: 1.9 };

  const mrPred = prediction({});
  const ouPred = prediction({
    id: "pred-ou",
    recommendation: "over",
    marketParams: { line: 2.5 },
    createdAt: new Date(Date.parse(T0) + 20_000),
  });

  it("mesmas análises → mesmo palpite pelos dois caminhos", () => {
    const outcomes: FanOutOutcome[] = [
      {
        ok: true,
        marketKey: "match_result",
        result: {
          prediction: mrPred,
          marketKey: "match_result",
          selections: (["home", "draw", "away"] as const).map((key) => ({
            key,
            modelProbPct: 33,
            odd: memOdds[key],
          })),
        },
      },
      {
        ok: true,
        marketKey: "over_under",
        result: {
          prediction: ouPred,
          marketKey: "over_under",
          selections: (["over", "under"] as const).map((key) => ({
            key,
            modelProbPct: 50,
            odd: ouMem[key],
          })),
        },
      },
    ];
    const history: PredictionWithAiCall[] = [
      {
        prediction: ouPred,
        aiCall: null,
        marketKey: "over_under",
        selections: (["over", "under"] as const).map((key) => ({
          key,
          modelProbPct: 50,
          odd: ouDb[key],
        })),
      },
      {
        prediction: mrPred,
        aiCall: null,
        marketKey: "match_result",
        selections: (["home", "draw", "away"] as const).map((key) => ({
          key,
          modelProbPct: 33,
          odd: dbOdds[key],
        })),
      },
    ] as unknown as PredictionWithAiCall[];

    const mem = resolvePregamePick(summarizeAnalysesForSynthesis(outcomes));
    const saved = resolvePregamePick(summarizeSavedAnalysesForSynthesis(history));
    expect(mem).not.toBeNull();
    expect(mem!.fit!.anchor).toBe("over_under");
    expect(saved).toEqual(mem);
  });

  it("empate na 4ª casa (2.0025): em memória arredonda como o insert grava", () => {
    // O insert manda `toFixed(3)` → "2.002"; `Math.round(x*1000)/1000` daria 2.003.
    const mem3 = { home: 2.0025, draw: 3.4, away: 3.6 };
    const db3 = { home: 2.002, draw: 3.4, away: 3.6 };
    const outcomes: FanOutOutcome[] = [
      {
        ok: true,
        marketKey: "match_result",
        result: {
          prediction: mrPred,
          marketKey: "match_result",
          selections: (["home", "draw", "away"] as const).map((key) => ({
            key,
            modelProbPct: 33,
            odd: mem3[key],
          })),
        },
      },
    ];
    const history = [
      {
        prediction: mrPred,
        aiCall: null,
        marketKey: "match_result",
        selections: (["home", "draw", "away"] as const).map((key) => ({
          key,
          modelProbPct: 33,
          odd: db3[key],
        })),
      },
    ] as unknown as PredictionWithAiCall[];
    const memSummaries = summarizeAnalysesForSynthesis(outcomes);
    const savedSummaries = summarizeSavedAnalysesForSynthesis(history);
    expect(memSummaries[0].odds).toEqual(db3);
    expect(memSummaries[0].odds).toEqual(savedSummaries[0].odds);
    expect(resolvePregamePick(savedSummaries)).toEqual(resolvePregamePick(memSummaries));
  });

  it("histórico com over/under de OUTRO run: ignorado (empate ancora)", () => {
    const oldOu = prediction({
      id: "pred-ou-old",
      recommendation: "over",
      marketParams: { line: 2.5 },
      createdAt: new Date(Date.parse(T0) - 3 * 60 * 60 * 1000),
    });
    const history = [
      {
        prediction: mrPred,
        aiCall: null,
        marketKey: "match_result",
        selections: (["home", "draw", "away"] as const).map((key) => ({
          key,
          modelProbPct: 33,
          odd: dbOdds[key],
        })),
      },
      {
        prediction: oldOu,
        aiCall: null,
        marketKey: "over_under",
        selections: (["over", "under"] as const).map((key) => ({
          key,
          modelProbPct: 50,
          odd: ouDb[key],
        })),
      },
    ] as unknown as PredictionWithAiCall[];
    const pick = resolvePregamePick(summarizeSavedAnalysesForSynthesis(history));
    expect(pick!.fit!.anchor).toBe("draw");
    expect(pick!.fit!.overUnderPredictionId).toBeNull();
  });
});

// ─── #683: o que pesou, gravado no pick ──────────────────────────────────────

describe("pick.weighed (#683)", () => {
  const product = (
    w: NonNullable<PalpitePick["weighed"]>,
    side: "home" | "away"
  ) =>
    w.factors
      .filter((f) => f.lambdaSide === side)
      .reduce((a, f) => a * f.multiplier, 1);

  it("base de mercado: weighed presente e Π m' = pick.multipliers", () => {
    const j = codeJev({
      base: { home: 1, away: 1 },
      jev: VIRA.jev,
      user: VIRA.user,
    });
    const pick = resolvePregamePick([mr(VIRA.odds, j), ou(...VIRA.ou)])!;
    expect(pick.source).toBe("market");
    const w = pick.weighed!;
    expect(w).toBeTruthy();
    expect(product(w, "home")).toBeCloseTo(pick.multipliers!.home, 5);
    expect(product(w, "away")).toBeCloseTo(pick.multipliers!.away, 5);
  });

  it("base dc_jev: weighed presente, base = λ base do modelo", () => {
    const j = codeJev({ base: { home: 1.4, away: 1.0 }, jev: NAO_VIRA.jev });
    const pick = resolvePregamePick([{ ...mr(NAO_VIRA.odds, j), odds: {} }])!;
    expect(pick.source).toBe("dc_jev");
    const w = pick.weighed!;
    expect(w.factors.map((f) => f.key)).toEqual([
      "attack_weakened_home",
      "defense_weakened_away",
      "high_stakes_away",
    ]);
    expect(product(w, "home")).toBeCloseTo(pick.multipliers!.home, 5);
    expect(w.finalPts.home + w.finalPts.draw + w.finalPts.away).toBe(100);
  });

  it("sem julgamentos (motor LLM no 1X2) → factors []", () => {
    const pick = resolvePregamePick([mr(VIRA.odds, null)])!;
    expect(pick.multipliers).toBeNull();
    expect(pick.weighed!.factors).toEqual([]);
    expect(pick.weighed!.basePts).toEqual(pick.weighed!.finalPts);
  });

  it("JEV falho sem contexto → factors [] (nenhum ajuste)", () => {
    const pick = resolvePregamePick([mr(VIRA.odds, codeJev({ jev: null }))])!;
    expect(pick.multipliers).toEqual({ home: 1, away: 1 });
    expect(pick.weighed!.factors).toEqual([]);
  });

  it("análise de origem sem `factors` → null", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = codeJev({ jev: VIRA.jev });
    const a = mr(VIRA.odds, j);
    const pick = resolvePregamePick([
      { ...a, judgmentsModel: { ...a.judgmentsModel!, factors: undefined } },
    ])!;
    expect(pick.weighed).toBeNull();
    warn.mockRestore();
  });

  it("fatores tortos na análise de origem: o palpite sai, sem o weighed (aviso)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = codeJev({ jev: VIRA.jev });
    const a = mr(VIRA.odds, j);
    const torto = {
      ...a.judgmentsModel!.factors!,
      applied: null,
      product: null,
    } as unknown as WeighedInputs;
    const pick = resolvePregamePick([
      { ...a, judgmentsModel: { ...a.judgmentsModel!, factors: torto } },
    ]);
    expect(pick).not.toBeNull();
    expect(pick!.weighed).toBeNull();
    expect(warn).toHaveBeenCalledWith({ scope: "palpite_weighed", reason: "error" });
    warn.mockRestore();
  });

  // Regressão com os cenários do mock v6, com os números do motor real (os do mock
  // eram ilustrativos).
  it("Galo x Boca, vira: 37/30/33 → 34/30/36, pro Boca", () => {
    const j = codeJev({
      base: { home: 1, away: 1 },
      jev: VIRA.jev,
      user: VIRA.user,
    });
    const pick = resolvePregamePick([mr(VIRA.odds, j), ou(...VIRA.ou)])!;
    const w = pick.weighed!;
    expect(pick.outcome).toBe("away");
    expect(w.baseOutcome).toBe("home");
    expect(w.basePts).toEqual({ home: 37, draw: 30, away: 33 });
    expect(w.finalPts).toEqual({ home: 34, draw: 30, away: 36 });
    // Os três tiram do Galo e dão ao Boca. O rodízio, contado pelo usuário, tira 0,66 pp
    // do Galo e dá 0,16 ao empate: o empate não pode sair com −1 dele (o fator deu chance
    // ao empate), então o ponto do Boca sai do Galo. Quem fecha a coluna do empate é o
    // ataque (−2/+1/+1 no arredondamento), que devolve ao Galo o ponto do empate.
    expect(w.factors.map((f) => [f.key, f.origin, f.pts])).toEqual([
      ["attack_weakened_home", "jev", { home: -1, draw: 0, away: 1 }],
      ["defense_weakened_home", "jev", { home: -1, draw: 0, away: 1 }],
      ["rotation_risk_home", "user", { home: -1, draw: 0, away: 1 }],
    ]);
    for (const f of w.factors) {
      for (const k of ["home", "draw", "away"] as const) {
        if (f.pts[k] !== 0) expect(Math.sign(f.pts[k])).toBe(Math.sign(f.pp[k]));
      }
    }
  });

  it("Galo x Boca, não vira: 52/27/21 → 51/28/21, continua Galo", () => {
    const j = codeJev({ base: { home: 1, away: 1 }, jev: NAO_VIRA.jev });
    const pick = resolvePregamePick([
      mr(NAO_VIRA.odds, j),
      ou(...NAO_VIRA.ou),
    ])!;
    const w = pick.weighed!;
    expect(pick.outcome).toBe("home");
    expect(w.baseOutcome).toBe("home");
    expect(w.basePts).toEqual({ home: 52, draw: 27, away: 21 });
    expect(w.finalPts).toEqual({ home: 51, draw: 28, away: 21 });
    expect(w.factors.map((f) => [f.key, f.pts])).toEqual([
      ["attack_weakened_home", { home: -2, draw: 1, away: 1 }],
      ["defense_weakened_away", { home: 1, draw: 0, away: -1 }],
      ["high_stakes_away", { home: 0, draw: 0, away: 0 }],
    ]);
  });

  it("memória × histórico (chaves do jsonb embaralhadas) → weighed igual (R10)", () => {
    const j = codeJev({
      base: { home: 1.2, away: 1.4 },
      jev: {
        attack_weakened_home: 0.9,
        defense_weakened_away: 0.8,
        high_stakes_home: 0.85,
      },
      user: { rotation_risk_away: 0.7 },
    });
    const shuffled: PredictionJudgments = JSON.parse(JSON.stringify(j));
    for (const side of ["home", "away"] as const) {
      const f = shuffled.multipliers![side].factors;
      shuffled.multipliers![side].factors = Object.fromEntries(
        Object.entries(f).reverse()
      );
    }
    const odds = { home: 2.9, draw: 3.3, away: 2.35 };
    const sels = (["home", "draw", "away"] as const).map((key) => ({
      key,
      modelProbPct: 33,
      odd: odds[key],
    }));
    const mem = resolvePregamePick(
      summarizeAnalysesForSynthesis([
        {
          ok: true,
          marketKey: "match_result",
          result: {
            prediction: prediction({ judgments: j }),
            marketKey: "match_result",
            selections: sels,
          },
        },
      ] as FanOutOutcome[])
    )!;
    const saved = resolvePregamePick(
      summarizeSavedAnalysesForSynthesis([
        {
          prediction: prediction({ judgments: shuffled }),
          aiCall: null,
          marketKey: "match_result",
          selections: sels,
        },
      ] as unknown as PredictionWithAiCall[])
    )!;
    expect(mem.weighed).toBeTruthy();
    expect(saved.weighed).toEqual(mem.weighed);
  });
});
