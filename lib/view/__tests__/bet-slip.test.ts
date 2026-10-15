import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";
import type { AnalysisMarket } from "@/lib/bets/analysis-probs";
import {
  evaluateSlip,
  type ReferenceMarket,
  type SlipEvaluation,
  type SlipLegInput,
} from "@/lib/bets/evaluate-slip";
import { TOP_EXACT_SCORES } from "@/lib/bets/slip-markets";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { p1X2, pBtts, scorelineMatrix } from "@/lib/quant/scoreline-model";
import { formatPct } from "@/lib/format";
import { modelProbabilities } from "@/lib/model-base/build-snapshot";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { RISK_DISCLAIMER } from "@/lib/view/share/disclaimer";
import {
  historyLegSummary,
  MODEL_CAVEAT_PT_BR,
  RISK_DISCLAIMER_PT_BR,
  toBetGridView,
  toSlipEvaluationView,
  valueReading,
} from "@/lib/view/bet-slip";

const TEAMS = { home: "Flamengo", away: "Palmeiras" };

const MODEL: ModelScoreline = {
  source: "dixon_coles",
  degraded: false,
  lambdaHome: 1.6,
  lambdaAway: 1.0,
  matrix: scorelineMatrix(1.6, 1.0),
};

const ref = (odds: Record<string, number>): ReferenceMarket => ({
  bookmaker: "pinnacle",
  capturedAt: new Date("2026-10-12T12:00:00Z"),
  odds,
});

const analysisMarket = (probs: Record<string, number>): AnalysisMarket => ({
  predictionId: "pred-1",
  createdAt: new Date("2026-10-12T10:00:00Z"),
  probs,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("toBetGridView", () => {
  const view = toBetGridView({
    teams: TEAMS,
    model: MODEL,
    references: new Map([
      ["match_result", ref({ home: 2.1, draw: 3.3, away: 3.6 })],
    ]),
    analysis: new Map(),
  });

  it("grupos fixos na ordem, com títulos em PT-BR", () => {
    expect(view.groups.map((g) => [g.key, g.title])).toEqual([
      ["match_result", "Resultado"],
      ["double_chance", "Dupla chance"],
      ["btts", "Ambas marcam"],
      ["over_under:1.5", "Total de gols 1,5"],
      ["over_under:2.5", "Total de gols 2,5"],
      ["over_under:3.5", "Total de gols 3,5"],
    ]);
  });

  it("rótulos com o nome dos times", () => {
    const [mr, dc, btts, ou15] = view.groups;
    expect(mr.selections.map((s) => s.label)).toEqual([
      "Flamengo",
      "Empate",
      "Palmeiras",
    ]);
    expect(mr.selections.map((s) => s.legLabel)).toEqual([
      "Vitória do Flamengo",
      "Empate",
      "Vitória do Palmeiras",
    ]);
    expect(dc.selections.map((s) => s.label)).toEqual([
      "Flamengo ou empate",
      "Flamengo ou Palmeiras",
      "Empate ou Palmeiras",
    ]);
    expect(dc.selections[0].legLabel).toBe("Dupla chance: Flamengo ou empate");
    expect(btts.selections.map((s) => s.label)).toEqual(["Sim", "Não"]);
    expect(ou15.selections.map((s) => s.label)).toEqual([
      "Mais de 1,5",
      "Menos de 1,5",
    ]);
    expect(ou15.selections[0].legLabel).toBe("Mais de 1,5 gols");
  });

  it("odd de referência quando existe; odd justa do modelo sempre presente", () => {
    const home = view.groups[0].selections[0];
    const pHome = p1X2(MODEL.matrix).home * 100;
    expect(home.id).toBe("match_result:home");
    expect(home.referenceOdd).toBe(2.1);
    expect(home.modelProbPct).toBe(round2(pHome));
    expect(home.fairOdd).toBe(round2(100 / pHome));

    const bttsYes = view.groups[2].selections[0];
    expect(bttsYes.referenceOdd).toBeNull();
    expect(bttsYes.fairOdd).toBe(round2(100 / (pBtts(MODEL.matrix) * 100)));
  });

  it("placares mais prováveis + matriz 10×10 e rótulo do modelo", () => {
    expect(view.topScores).toHaveLength(TOP_EXACT_SCORES);
    const probs = view.topScores.map((s) => s.modelProbPct ?? 0);
    expect([...probs].sort((a, b) => b - a)).toEqual(probs);
    for (const s of view.topScores) {
      expect(s.groupKey).toBe("exact_score");
      expect(s.referenceOdd).toBeNull();
      expect(s.label).toMatch(/^\d × \d$/);
      expect(s.legLabel).toMatch(/^Placar exato: Flamengo \d × \d Palmeiras$/);
    }
    expect(view.exactScoreProbPct).toHaveLength(10);
    expect(view.exactScoreProbPct?.every((r) => r.length === 10)).toBe(true);
    expect(view.model).toEqual({ label: "modelo Dixon-Coles", computedAgo: null });
  });

  it("prob da análise do mercado tem precedência na grade", () => {
    const v = toBetGridView({
      teams: TEAMS,
      model: MODEL,
      references: new Map(),
      analysis: new Map([["match_result", analysisMarket({ home: 61 })]]),
    });
    const home = v.groups[0].selections[0];
    expect(home.modelProbPct).toBe(61);
    expect(home.fairOdd).toBe(round2(100 / 61));
  });

  it("sem modelo: sem placares, sem matriz, sem rótulo; análise ainda aparece", () => {
    const v = toBetGridView({
      teams: TEAMS,
      model: null,
      references: new Map(),
      analysis: new Map([["btts", analysisMarket({ yes: 55 })]]),
    });
    expect(v.topScores).toEqual([]);
    expect(v.exactScoreProbPct).toBeNull();
    expect(v.model).toBeNull();
    expect(v.groups[0].selections[0].fairOdd).toBeNull();
    expect(v.groups[0].selections[0].modelProbPct).toBeNull();
    expect(v.groups[2].selections[0].modelProbPct).toBe(55);
    expect(v.groups[2].selections[1].modelProbPct).toBeNull();
  });

  it("modelo heurístico degradado → rótulo de dados limitados", () => {
    const v = toBetGridView({
      teams: TEAMS,
      model: { ...MODEL, source: "heuristic", degraded: true },
      references: new Map(),
      analysis: new Map(),
    });
    expect(v.model?.label).toBe("modelo simplificado (dados limitados)");
  });
});

describe("toBetGridView — tabela de mercados (#576)", () => {
  const NOW = new Date("2026-10-12T12:12:00Z");
  const MR = { home: 2.1, draw: 3.3, away: 3.6 };
  const OU25 = { over: 1.9, under: 1.95 };
  // Dupla chance derivada de um 1X2 justo 50/28/22 com 5% de margem.
  const raw = [0.5 * 1.05, 0.28 * 1.05, 0.22 * 1.05];
  const DC = {
    home_or_draw: 1 / (raw[0] + raw[1]),
    away_or_draw: 1 / (raw[1] + raw[2]),
    home_or_away: 1 / (raw[0] + raw[2]),
  };
  const pctNum = (s: string) => Number(s.replace("%", "").replace(",", "."));

  const view = toBetGridView({
    teams: TEAMS,
    model: { ...MODEL, baseCheckedAt: new Date("2026-10-12T09:12:00Z") },
    references: new Map([
      ["match_result", ref(MR)],
      ["double_chance", ref(DC)],
      ["over_under:2.5", ref(OU25)],
      // Incompleto: só um lado.
      ["btts", ref({ yes: 1.8 })],
    ]),
    analysis: new Map([
      ["match_result", { ...analysisMarket({ home: 52, draw: 26, away: 22 }), recommendation: "home" }],
      ["over_under:1.5", { ...analysisMarket({ over: 74, under: 26 }), recommendation: "over" }],
      ["btts", { ...analysisMarket({ yes: 50, no: 50 }), recommendation: "pass" }],
      ["double_chance", { ...analysisMarket({ home_or_draw: 78 }), recommendation: "home_or_draw" }],
    ]),
    modelReading: { source: "Dixon-Coles", jev: "+ JEV" },
    now: NOW,
  });
  const group = (key: string) => view.groups.find((g) => g.key === key)!;

  it("chance do mercado do 1X2 e do total batem com computeMarketImpliedProbabilities", () => {
    for (const [key, odds] of [
      ["match_result", MR],
      ["over_under:2.5", OU25],
    ] as const) {
      const { probs } = computeMarketImpliedProbabilities(Object.values(odds));
      expect(group(key).odds?.impliedPct).toEqual(
        probs.map((p) => formatPct(p * 100, { decimals: 1 })),
      );
    }
  });

  it("margem com alvo 1 = overround; idade da captura por mercado", () => {
    const { overround } = computeMarketImpliedProbabilities(Object.values(MR));
    expect(group("match_result").odds?.margin).toBe(formatPct(overround * 100, { decimals: 1 }));
    expect(group("match_result").odds?.updatedAgo).toBe("há 12min");
  });

  it("dupla chance: chances somam 200% e a margem sai ≈5% (não 10%)", () => {
    const dc = group("double_chance").odds!;
    const sum = dc.impliedPct.map(pctNum).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(200, 0);
    expect(dc.margin).toBe("5,0%");
    // Na ordem da grade (home_draw, home_away, draw_away), não na do mercado.
    expect(pctNum(dc.impliedPct[0])).toBeCloseTo(78, 0);
    expect(pctNum(dc.impliedPct[1])).toBeCloseTo(72, 0);
    expect(pctNum(dc.impliedPct[2])).toBeCloseTo(50, 0);
  });

  it("mercado incompleto ou sem captura → odds: null", () => {
    expect(group("btts").odds).toBeNull();
    expect(group("over_under:3.5").odds).toBeNull();
  });

  it("marca IA só na seleção recomendada, na linha certa, e nunca em pass", () => {
    const picks = view.groups.flatMap((g) => g.selections.filter((s) => s.aiPick).map((s) => s.id));
    expect(picks).toEqual([
      "match_result:home",
      "double_chance:home_draw",
      "over_under:1.5:over",
    ]);
    expect(group("over_under:2.5").selections.some((s) => s.aiPick)).toBe(false);
    expect(view.topScores.some((s) => s.aiPick)).toBe(false);
  });

  it("probSource por mercado", () => {
    expect(group("match_result").probSource).toBe("analysis");
    expect(group("over_under:1.5").probSource).toBe("analysis");
    expect(group("over_under:2.5").probSource).toBe("model");
    const noModel = toBetGridView({
      teams: TEAMS,
      model: null,
      references: new Map(),
      analysis: new Map(),
    });
    expect(noModel.groups.every((g) => g.probSource === null)).toBe(true);
  });

  it("modelo da base: rótulo da leitura (fonte + JEV) e calculado há", () => {
    expect(view.model).toEqual({ label: "modelo Dixon-Coles + JEV", computedAgo: "há 3h" });
    expect(view.mode).toBe("register");
    expect(view.oddsHeading).toBe("Odds de mercado");
    expect(view.noOdds).toBeNull();
  });

  it("cálculo na hora: sem calculado há, mesmo com a leitura da base disponível", () => {
    const v = toBetGridView({
      teams: TEAMS,
      model: MODEL,
      references: new Map(),
      analysis: new Map(),
      modelReading: { source: "Dixon-Coles", jev: "+ JEV" },
      now: NOW,
    });
    expect(v.model).toEqual({ label: "modelo Dixon-Coles", computedAgo: null });
  });

  it("só leitura: sem modelo, sem placares, odds antes do jogo", () => {
    const v = toBetGridView({
      teams: TEAMS,
      model: MODEL,
      references: new Map([["match_result", ref(MR)]]),
      analysis: new Map(),
      mode: "readOnly",
      unavailable: "finished",
      now: NOW,
    });
    expect(v.mode).toBe("readOnly");
    expect(v.oddsHeading).toBe("Odds antes do jogo");
    expect(v.topScores).toEqual([]);
    expect(v.exactScoreProbPct).toBeNull();
    expect(v.model).toBeNull();
    expect(v.groups[0].selections[0].referenceOdd).toBe(2.1);
    expect(v.groups[0].selections[0].modelProbPct).toBeNull();
  });

  it("nenhuma captura: aviso de odds indisponíveis por estado", () => {
    const at = (unavailable: "live" | "finished" | null) =>
      toBetGridView({ teams: TEAMS, model: null, references: new Map(), analysis: new Map(), unavailable })
        .noOdds;
    expect(at(null)).toBe(
      "Sem cotação publicada para este jogo. Análise indisponível até que o mercado abra.",
    );
    expect(at("live")).toBe("Jogo em andamento, sem cotação pré-jogo publicada.");
    expect(at("finished")).toBe("Sem cotação de referência para este jogo.");
  });

  it("paridade: modelo da base e mercado sem análise → a mesma chance da Leitura do modelo", () => {
    const base = { ...MODEL, baseCheckedAt: new Date("2026-10-12T09:00:00Z") };
    const v = toBetGridView({ teams: TEAMS, model: base, references: new Map(), analysis: new Map() });
    const probs = modelProbabilities(base.matrix);
    const expected: Record<string, number> = {
      "match_result:home": probs.match_result.home,
      "match_result:draw": probs.match_result.draw,
      "match_result:away": probs.match_result.away,
      "double_chance:home_draw": probs.double_chance.home_or_draw,
      "double_chance:home_away": probs.double_chance.home_or_away,
      "double_chance:draw_away": probs.double_chance.away_or_draw,
      "btts:yes": probs.btts.yes,
      "btts:no": probs.btts.no,
      "over_under:1.5:over": probs.over_under["1.5"].over,
      "over_under:2.5:under": probs.over_under["2.5"].under,
      "over_under:3.5:over": probs.over_under["3.5"].over,
    };
    const cells = new Map(v.groups.flatMap((g) => g.selections).map((s) => [s.id, s]));
    for (const [id, pct] of Object.entries(expected)) {
      expect(Math.abs((cells.get(id)?.modelProbPct ?? -1) - pct), id).toBeLessThanOrEqual(0.1);
    }
  });
});

function evaluate(
  mode: "simples" | "combinada",
  legs: SlipLegInput[],
  over: Partial<Parameters<typeof evaluateSlip>[0]> = {}
): SlipEvaluation {
  return evaluateSlip({
    mode,
    legs,
    model: MODEL,
    references: new Map(),
    analysis: new Map(),
    comboUserOdd: null,
    comboStakeUnits: null,
    ...over,
  });
}

const leg = (
  kind: string,
  params: Record<string, unknown>,
  userOdd: number | null = null,
  stakeUnits: number | null = null
): SlipLegInput => ({
  kind,
  params: params as BetLegParams,
  userOdd,
  stakeUnits,
});

describe("toSlipEvaluationView", () => {
  it("sempre traz stakeRuleNote (com o teto de 3u) e o aviso do modelo", () => {
    const v = toSlipEvaluationView(
      evaluate("simples", [leg("match_result", { selection: "home" })]),
      TEAMS
    );
    expect(v.mode).toBe("simples");
    expect(v.combo).toBeNull();
    expect(v.modelCaveat).toBe(MODEL_CAVEAT_PT_BR);
    expect(v.modelCaveat.length).toBeGreaterThan(0);
    expect(v.stakeRuleNote).toContain("3u por jogo");
    expect(v.stakeRuleNote).not.toContain("reduzimos");
  });

  it("stakeRuleNote avisa quando o teto por jogo reduziu as pernas", () => {
    const analysis = new Map([
      ["match_result", analysisMarket({ home: 60 })],
      ["over_under:2.5", analysisMarket({ over: 60 })],
      ["btts", analysisMarket({ yes: 60 })],
      ["double_chance", analysisMarket({ home_or_draw: 80 })],
    ]);
    const evaluation = evaluate(
      "simples",
      [
        leg("match_result", { selection: "home" }, 2.5),
        leg("over_under", { selection: "over", line: 2.5 }, 2.5),
        leg("btts", { selection: "yes" }, 2.5),
        leg("double_chance", { selection: "home_draw" }, 1.6),
      ],
      { analysis }
    );
    expect(evaluation.cappedAtMatchLimit).toBe(true);
    const v = toSlipEvaluationView(evaluation, TEAMS);
    expect(v.stakeRuleNote).toContain("reduzimos as pernas");
  });

  it("perna gradeada pela análise: fonte, EV, edge e stake formatados", () => {
    const evaluation = evaluate(
      "simples",
      [leg("match_result", { selection: "home" }, 2.5, 1.5)],
      {
        analysis: new Map([["match_result", analysisMarket({ home: 60 })]]),
        references: new Map([
          ["match_result", ref({ home: 2.5, draw: 3.3, away: 3.0 })],
        ]),
      }
    );
    const [l] = toSlipEvaluationView(evaluation, TEAMS).legs;
    expect(l.status).toBe("graded");
    expect(l.label).toBe("Vitória do Flamengo");
    expect(l.modelProb).toBe("60,0%");
    expect(l.fairOdd).toBe("1,67");
    expect(l.sourceLabel).toBe("sua análise deste mercado");
    expect(l.userOdd).toBe("2,50");
    expect(l.ev).toBe("+50,0%");
    expect(l.breakEven).toBe("40,0%");
    expect(l.edge).toMatch(/^\+\d+,\d pontos$/);
    expect(l.edgeNote).toContain("contra o mercado (odd 2,50, sem a margem)");
    expect(l.reading).toBe(valueReading(0.5));
    expect(l.suggestedStake).toMatch(/u \(bandas\)$/);
    expect(l.userStake).toBe("1,5u");
  });

  it("perna pelo modelo sem referência: fonte do modelo e nota de sem referência", () => {
    const [l] = toSlipEvaluationView(
      evaluate("simples", [leg("btts", { selection: "yes" })]),
      TEAMS
    ).legs;
    expect(l.sourceLabel).toBe("modelo Dixon-Coles");
    expect(l.edge).toBeNull();
    expect(l.edgeNote).toBe(
      "sem odd de referência recente e completa deste mercado"
    );
    expect(l.reading).toBe(valueReading(null));
    expect(l.suggestedStake).toBeNull();
  });

  it("cartões → not_covered com leitura própria", () => {
    const [l] = toSlipEvaluationView(
      evaluate("simples", [
        leg("cards", { selection: "over", line: 4.5 }, 1.9),
      ]),
      TEAMS
    ).legs;
    expect(l.status).toBe("not_covered");
    expect(l.modelProb).toBeNull();
    expect(l.userOdd).toBe("1,90");
    expect(l.reading).toContain("cartões nem escanteios");
  });

  it("combinada gradeada traz marginais rotuladas", () => {
    const v = toSlipEvaluationView(
      evaluate(
        "combinada",
        [
          leg("match_result", { selection: "home" }),
          leg("btts", { selection: "yes" }),
        ],
        { comboUserOdd: 4, comboStakeUnits: 2 }
      ),
      TEAMS
    );
    if (v.combo?.status !== "graded") throw new Error("combo não gradeada");
    expect(v.combo.marginals.map((m) => m.label)).toEqual([
      "Vitória do Flamengo",
      "Ambas marcam: sim",
    ]);
    expect(v.combo.sourceLabel).toBe("modelo Dixon-Coles");
    expect(v.combo.userOdd).toBe("4,00");
    expect(v.combo.userStake).toBe("2u");
  });

  it("combinada sem modelo → razão em texto", () => {
    const v = toSlipEvaluationView(
      evaluate(
        "combinada",
        [
          leg("match_result", { selection: "home" }),
          leg("btts", { selection: "yes" }),
        ],
        { model: null }
      ),
      TEAMS
    );
    expect(v.combo).toEqual({
      status: "not_evaluated",
      reason:
        "Não deu pra estimar o placar deste jogo agora, então a combinada ficou sem número.",
    });
    expect(v.legs.map((l) => l.status)).toEqual(["no_data", "no_data"]);
  });
});

describe("valueReading", () => {
  it("descritivo por sinal do EV (nunca imperativo)", () => {
    expect(valueReading(0.1)).toContain("tem valor");
    expect(valueReading(-0.1)).toContain("não tem valor");
    expect(valueReading(0.0004)).toContain("no limite");
    expect(valueReading(null)).toContain("Sem a odd");
    for (const r of [
      valueReading(0.1),
      valueReading(-0.1),
      valueReading(0),
      valueReading(null),
    ]) {
      expect(r).not.toMatch(/\baposte\b|\bapostar\b|garant/i);
    }
  });
});

describe("historyLegSummary", () => {
  it("perna gravada com campos do modelo", () => {
    expect(
      historyLegSummary({
        userOdd: "2.100",
        modelProbPct: "52.30",
        gradeSource: "scoreline_model",
        modelSource: "dixon_coles",
        marketImpliedPct: "47.80",
        stakeUnits: "1.00",
        suggestedStakeUnits: "1.50",
      })
    ).toEqual([
      "chance 52,3%",
      "odd 2,10",
      "retorno esperado +9,8%",
      "vantagem do modelo +4,5 pontos",
      "seu stake 1u",
      "sugerido 1,5u",
      "Dixon-Coles",
    ]);
  });

  it("perna da análise mostra 'sua análise'", () => {
    const parts = historyLegSummary({
      userOdd: null,
      modelProbPct: "60.00",
      gradeSource: "cartridge",
      modelSource: null,
      marketImpliedPct: null,
      stakeUnits: null,
      suggestedStakeUnits: null,
    });
    expect(parts).toEqual(["chance 60,0%", "sua análise"]);
  });

  it("perna sem campos do modelo (antiga ou não gradeada)", () => {
    expect(
      historyLegSummary({
        userOdd: "1.900",
        modelProbPct: null,
        gradeSource: "none",
        modelSource: null,
        marketImpliedPct: null,
        stakeUnits: "2.00",
        suggestedStakeUnits: null,
      })
    ).toEqual(["odd 1,90", "seu stake 2u"]);
  });

  it("heurístico e modelo desconhecido", () => {
    const base = {
      userOdd: null,
      modelProbPct: "40.00",
      gradeSource: "scoreline_model" as const,
      marketImpliedPct: null,
      stakeUnits: null,
      suggestedStakeUnits: null,
    };
    expect(
      historyLegSummary({ ...base, modelSource: "heuristic" }).at(-1)
    ).toBe("modelo simplificado");
    expect(historyLegSummary({ ...base, modelSource: null }).at(-1)).toBe(
      "modelo de placar"
    );
  });
});

describe("RISK_DISCLAIMER_PT_BR", () => {
  it("é o §3 completo, idêntico ao canônico de lib/view/share/disclaimer", () => {
    expect(RISK_DISCLAIMER_PT_BR).toBe(RISK_DISCLAIMER);
  });
});
