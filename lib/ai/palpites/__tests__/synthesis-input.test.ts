import { describe, expect, it } from "vitest";

import type { FanOutOutcome } from "@/lib/ai/best-bet";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers, JudgmentQuestionId } from "@/lib/ai/judgments/types";
import type { Prediction } from "@/lib/ai/predict";
import {
  MarketAnalysisSchema,
  buildUserMessage,
  type PalpitesInput,
} from "@/lib/ai/palpites/cartridges/cartridge";
import {
  summarizeAnalysesForSynthesis,
  summarizeSavedAnalysesForSynthesis,
  type MarketAnalysisSummary,
} from "@/lib/ai/palpites/synthesis-input";
import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";

// Prediction stub mínima: só os campos lidos pela projeção (Drizzle numeric → STRING).
function prediction(over: Partial<Prediction> = {}): Prediction {
  return {
    id: "pred-1",
    recommendation: "home",
    edgePct: "9.00",
    confidencePct: "60.00",
    oddAtRecommendation: "1.850",
    rationale: "Mandante superior.",
    ...over,
  } as unknown as Prediction;
}

function okOutcome(
  marketKey: string,
  pred: Prediction,
  selections: { key: string; modelProbPct: number; odd: number | null; label?: string }[],
): FanOutOutcome {
  return {
    ok: true,
    marketKey,
    result: { prediction: pred, marketKey, selections },
  };
}

describe("summarizeAnalysesForSynthesis", () => {
  it("projeta um outcome ok: lê os campos PERSISTIDOS Number()'d + marketLabel do descriptor", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("match_result", prediction(), [
        { key: "home", modelProbPct: 58, odd: 1.85 },
        { key: "draw", modelProbPct: 24, odd: 3.4 },
        { key: "away", modelProbPct: 18, odd: 4.2 },
      ]),
    ]);
    expect(out).toHaveLength(1);
    const a = out[0];
    expect(a.marketKey).toBe("match_result");
    expect(a.marketLabel).toBe("Resultado (1X2)");
    expect(a.recommendation).toBe("home");
    expect(a.recommendedLabel).toBe("Casa");
    expect(a.isPass).toBe(false);
    // numeric string → number no boundary.
    expect(a.edgePct).toBe(9);
    expect(a.confidencePct).toBe(60);
    expect(a.oddAtRecommendation).toBe(1.85);
    expect(a.modelProbPct).toBe(58); // da seleção recomendada
    expect(a.predictionId).toBe("pred-1");
    expect(a.selections).toHaveLength(3);
  });

  it("filtra outcomes de FALHA (só ok entram)", () => {
    const out = summarizeAnalysesForSynthesis([
      { ok: false, marketKey: "btts", message: "indisponível" },
      okOutcome("over_under", prediction(), [
        { key: "over", modelProbPct: 55, odd: 1.9 },
        { key: "under", modelProbPct: 45, odd: 2.0 },
      ]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].marketKey).toBe("over_under");
  });

  it("trata pass: recommendation='pass', isPass=true, edge/odd/modelProb null, recommendedLabel null", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome(
        "match_result",
        prediction({
          recommendation: "pass",
          edgePct: null,
          oddAtRecommendation: null,
        }),
        [
          { key: "home", modelProbPct: 40, odd: 2.5 },
          { key: "draw", modelProbPct: 30, odd: 3.0 },
          { key: "away", modelProbPct: 30, odd: 3.1 },
        ],
      ),
    ]);
    const a = out[0];
    expect(a.isPass).toBe(true);
    expect(a.recommendation).toBe("pass");
    expect(a.recommendedLabel).toBeNull();
    expect(a.edgePct).toBeNull();
    expect(a.oddAtRecommendation).toBeNull();
    expect(a.modelProbPct).toBeNull();
    // confidencePct ainda lido (numeric NOT NULL).
    expect(a.confidencePct).toBe(60);
  });

  it("ordena por edge desc (contexto); pass vai pro fim", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("over_under", prediction({ id: "p-lo", edgePct: "3.00" }), [
        { key: "over", modelProbPct: 51, odd: 1.95 },
        { key: "under", modelProbPct: 49, odd: 1.95 },
      ]),
      okOutcome("match_result", prediction({ id: "p-hi", edgePct: "12.00" }), [
        { key: "home", modelProbPct: 60, odd: 1.8 },
        { key: "draw", modelProbPct: 22, odd: 3.5 },
        { key: "away", modelProbPct: 18, odd: 4.0 },
      ]),
      okOutcome(
        "btts",
        prediction({ id: "p-pass", recommendation: "pass", edgePct: null }),
        [
          { key: "yes", modelProbPct: 50, odd: 1.9 },
          { key: "no", modelProbPct: 50, odd: 1.9 },
        ],
      ),
    ]);
    expect(out.map((a) => a.predictionId)).toEqual(["p-hi", "p-lo", "p-pass"]);
  });

  it("prefere o label threadado da seleção (dynamicSelections) ao selectionLabel do descriptor", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("anytime_scorer", prediction({ recommendation: "scorer_pedro" }), [
        { key: "scorer_pedro", modelProbPct: 35, odd: 2.5, label: "Pedro" },
      ]),
    ]);
    expect(out[0].recommendedLabel).toBe("Pedro");
    expect(out[0].selections[0].label).toBe("Pedro");
  });

  it("vazio → []", () => {
    expect(summarizeAnalysesForSynthesis([])).toEqual([]);
  });
});

describe("seleções sem probabilidade (regressão: derrubavam a síntese inteira)", () => {
  // Artilheiro/assistência só trazem prob pros jogadores que o modelo estimou; o resto
  // chegava com modelProbPct undefined e o schema da síntese rejeitava TODO o input.
  const scorer = okOutcome(
    "anytime_scorer",
    prediction({ id: "pred-scorer", recommendation: "p1" }),
    [
      { key: "p1", label: "Calleri", modelProbPct: 41, odd: 2.6 },
      {
        key: "p2",
        label: "Lucas",
        modelProbPct: undefined as unknown as number,
        odd: 3.1,
      },
    ],
  );

  it("descarta a seleção sem prob e mantém as outras", () => {
    const [a] = summarizeAnalysesForSynthesis([scorer]);
    expect(a.selections).toEqual([
      { key: "p1", label: "Calleri", modelProbPct: 41 },
    ]);
    expect(a.modelProbPct).toBe(41);
  });

  it("o resumo passa no schema de entrada da síntese", () => {
    const out = summarizeAnalysesForSynthesis([scorer]);
    for (const a of out) {
      expect(MarketAnalysisSchema.safeParse(a).success).toBe(true);
    }
  });

  it("recomendado sem prob → modelProbPct null (não undefined)", () => {
    const [a] = summarizeAnalysesForSynthesis([
      okOutcome("anytime_scorer", prediction({ recommendation: "p2" }), [
        { key: "p2", label: "Lucas", modelProbPct: Number.NaN, odd: 3.1 },
      ]),
    ]);
    expect(a.modelProbPct).toBeNull();
    expect(a.selections).toEqual([]);
    expect(MarketAnalysisSchema.safeParse(a).success).toBe(true);
  });
});

describe("summarizeSavedAnalysesForSynthesis (gerar só o palpite)", () => {
  function row(
    marketKey: string | null,
    pred: Prediction,
    selections: PredictionWithAiCall["selections"],
  ): PredictionWithAiCall {
    return { prediction: pred, aiCall: null, marketKey, selections };
  }

  it("usa só a análise mais recente de cada mercado (histórico em ordem desc)", () => {
    const out = summarizeSavedAnalysesForSynthesis([
      row("match_result", prediction({ id: "new-1x2" }), [
        { key: "home", modelProbPct: 58, odd: 1.85 },
      ]),
      row("match_result", prediction({ id: "old-1x2" }), [
        { key: "home", modelProbPct: 50, odd: 1.9 },
      ]),
      // marketKey null (histórica) → over/under
      row(null, prediction({ id: "ou", recommendation: "over" }), [
        { key: "over", modelProbPct: 55, odd: 2 },
      ]),
    ]);
    expect(out.map((a) => a.predictionId).sort()).toEqual(["new-1x2", "ou"]);
  });

  it("marketKey null (histórica) e 'over_under' são o mesmo mercado: fica só a mais recente", () => {
    const out = summarizeSavedAnalysesForSynthesis([
      row("over_under", prediction({ id: "new-ou", recommendation: "under" }), [
        { key: "under", modelProbPct: 52, odd: 1.9 },
      ]),
      row(null, prediction({ id: "old-ou", recommendation: "over" }), [
        { key: "over", modelProbPct: 55, odd: 2 },
      ]),
    ]);
    expect(out.map((a) => a.predictionId)).toEqual(["new-ou"]);
  });

  it("rótulo do recomendado carrega a linha gravada (Over 3.5, não 'Over' 2.5 implícito)", () => {
    const [a] = summarizeSavedAnalysesForSynthesis([
      row(
        "over_under",
        prediction({ recommendation: "over", marketParams: { line: 3.5 } }),
        [{ key: "over", modelProbPct: 40, odd: 2.4 }],
      ),
    ]);
    expect(a.recommendedLabel).toBe("Over 3.5");
  });

  it("prob não gravada (coalesce 0 no DB) vira ausente, não 0%", () => {
    const [a] = summarizeSavedAnalysesForSynthesis([
      row("anytime_scorer", prediction({ recommendation: "p1" }), [
        { key: "p1", label: "Calleri", modelProbPct: 41, modelProbKnown: true, odd: 2.6 },
        { key: "p2", label: "Lucas", modelProbPct: 0, modelProbKnown: false, odd: 3.1 },
      ]),
    ]);
    expect(a.selections).toEqual([
      { key: "p1", label: "Calleri", modelProbPct: 41 },
    ]);
    expect(MarketAnalysisSchema.safeParse(a).success).toBe(true);
  });
});

// ─── Contexto extra (#565): nada do usuário chega à síntese ─────────────────

describe("contexto extra fora da síntese (PLAN-565 §13.2)", () => {
  const USER_RATIONALE =
    "Segundo o que você informou, o Pedro está fora: desfalques tiram do Flamengo uma peça ofensiva central (informado por você, não conferido). O Palmeiras perde o zagueiro titular.";

  function answers(over: Partial<Record<JudgmentQuestionId, number>> = {}): JudgmentAnswers {
    return Object.fromEntries(
      JUDGMENT_QUESTION_IDS.map((id) => [id, { value: over[id] ?? 0.2, confidence: null }]),
    ) as JudgmentAnswers;
  }

  // JEV: defesa do visitante (0,9). Usuário: ataque do mandante, não conferido (0,7).
  function judgments(over: Partial<PredictionJudgments> = {}): PredictionJudgments {
    return {
      engine: "code_jev",
      applied: true,
      answers: answers({ defense_weakened_away: 0.9 }),
      multipliers: {
        home: {
          factors: { attack_weakened_home: 0.92, defense_weakened_away: 1.1 },
          product: 1.012,
          applied: 1.012,
        },
        away: { factors: {}, product: 1, applied: 1 },
      },
      lambda: {
        source: "heuristic",
        degraded: false,
        rho: null,
        base: { home: 1.5, away: 1.1 },
        adjusted: { home: 1.52, away: 1.1 },
      },
      versions: {
        judgments: "jev_judgments_v1",
        weights: "judgment_weights_v1",
        narrator: "narrator_v1.1",
        jevModel: "jev",
      },
      failure: null,
      stateHash: "h",
      aiCallId: null,
      reusedFromPredictionId: null,
      userContext: {
        claims: [
          {
            team: "home",
            topic: "absence",
            role: "attack",
            playersCount: 1,
            index: 0,
            status: "unverifiable",
            evidence: "Não está na nossa lista de desfalques do Flamengo.",
            sides: [{ side: "home", status: "unverifiable" }],
            playerChecks: [{ status: "unverifiable", questionId: "attack_weakened_home" }],
            signals: [{ questionId: "attack_weakened_home", strength: "unverified" }],
          },
        ],
        evidence: { attack_weakened_home: 0.7 },
        extractionAiCallId: "ai-x",
        warnings: [],
        versions: { userEvidence: "user_evidence_v1", extract: "user_palpite_extract_v1" },
      },
      ...over,
    };
  }

  const withUser = (j: PredictionJudgments | null = judgments()) =>
    prediction({ id: "p-ctx", rationale: USER_RATIONALE, judgments: j } as Partial<Prediction>);

  const SELECTIONS = [
    { key: "home", modelProbPct: 58, odd: 1.85 },
    { key: "draw", modelProbPct: 24, odd: 3.4 },
    { key: "away", modelProbPct: 18, odd: 4.2 },
  ];

  function expectNoUserText(summaries: MarketAnalysisSummary[]) {
    const prompt = buildUserMessage(
      {
        match: {
          league: "brasileirao_a",
          homeTeam: "Flamengo",
          awayTeam: "Palmeiras",
          kickoffAt: "2026-05-20T19:00:00.000Z",
        },
        analyses: summaries,
        homeForm: { team: "Flamengo", gamesConsidered: 0, avgGoalsFor: 0, avgGoalsAgainst: 0, results: [] },
        awayForm: { team: "Palmeiras", gamesConsidered: 0, avgGoalsFor: 0, avgGoalsAgainst: 0, results: [] },
        h2h: [],
        news: [],
      } as unknown as PalpitesInput,
      { daysToKickoff: 2 },
    );
    for (const text of [JSON.stringify(summaries), prompt]) {
      expect(text).not.toContain("informado por você");
      expect(text).not.toContain("você informou");
      expect(text).not.toContain("Pedro");
      // A frase do fator que o usuário moveu (ataque do mandante).
      expect(text).not.toContain("peça ofensiva central");
    }
    return prompt;
  }

  it("fan-out: com fator movido pelo usuário, o racional do narrador não vai; ficam só os fatores do JEV", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("match_result", withUser(), SELECTIONS),
    ]);
    const [a] = out;
    expect(a.rationale).toBe(
      "Fatores do modelo: Desfalques atingem a defesa ou o goleiro titular do visitante (gols esperados do mandante ajustados para cima) — sinal forte.",
    );
    // Probs, seleção e edge seguem os da row.
    expect(a.recommendation).toBe("home");
    expect(a.modelProbPct).toBe(58);
    expect(a.edgePct).toBe(9);
    expect(a.selections).toHaveLength(3);
    expect(MarketAnalysisSchema.safeParse(a).success).toBe(true);
    expect(expectNoUserText(out)).toContain("Racional: Fatores do modelo:");
  });

  it("refazer só o palpite (histórico salvo): mesma regra", () => {
    const out = summarizeSavedAnalysesForSynthesis([
      { prediction: withUser(), aiCall: null, marketKey: "match_result", selections: SELECTIONS },
    ]);
    expect(out[0].rationale).toContain("Fatores do modelo:");
    expectNoUserText(out);
  });

  it("sem outro fator do JEV: racional vazio, a linha 'Racional' some", () => {
    const j = judgments({ answers: answers() });
    j.multipliers!.home.factors = { attack_weakened_home: 0.92 };
    const out = summarizeAnalysesForSynthesis([okOutcome("match_result", withUser(j), SELECTIONS)]);
    expect(out[0].rationale).toBe("");
    expect(expectNoUserText(out)).not.toContain("Racional:");
  });

  it("JEV não rodou (answers null) e o usuário moveu: racional vazio", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("match_result", withUser(judgments({ answers: null, applied: false })), SELECTIONS),
    ]);
    expect(out[0].rationale).toBe("");
    expectNoUserText(out);
  });

  it("contexto ilegível: na dúvida, o racional do narrador não vai", () => {
    const j = judgments();
    (j as { userContext: unknown }).userContext = { claims: "x" };
    const out = summarizeAnalysesForSynthesis([okOutcome("match_result", withUser(j), SELECTIONS)]);
    expect(out[0].rationale).toBe("");
  });

  it("contexto sem efeito (JEV já mais forte) ou sem contexto: racional do narrador intacto", () => {
    const strongJev = judgments({ answers: answers({ attack_weakened_home: 0.9 }) });
    const noEffect = prediction({ rationale: "Mandante superior.", judgments: strongJev } as Partial<Prediction>);
    expect(
      summarizeAnalysesForSynthesis([okOutcome("match_result", noEffect, SELECTIONS)])[0].rationale,
    ).toBe("Mandante superior.");
    const { userContext: _u, ...noContext } = judgments();
    const plain = prediction({ rationale: "Mandante superior.", judgments: noContext } as Partial<Prediction>);
    expect(
      summarizeAnalysesForSynthesis([okOutcome("match_result", plain, SELECTIONS)])[0].rationale,
    ).toBe("Mandante superior.");
  });

  it("nota do contexto extra (#569) sem fator movido: o racional do narrador também não vai", () => {
    const j = judgments({ answers: answers({ attack_weakened_home: 0.9 }) });
    j.userContext!.claims.push({
      team: "home",
      topic: "other",
      otherKind: "coach_change",
      index: 1,
      status: "unverifiable",
      evidence: "Não conferimos esse tipo de informação; fica como contexto, sem efeito no modelo.",
      sides: [{ side: "home", status: "unverifiable" }],
      playerChecks: [],
      signals: [],
    });
    const noted = prediction({
      rationale: "Segundo o que você informou, há troca de técnico no Flamengo.",
      judgments: j,
    } as Partial<Prediction>);
    const out = summarizeAnalysesForSynthesis([okOutcome("match_result", noted, SELECTIONS)]);
    expect(out[0].rationale).toMatch(/^Fatores do modelo: /);
    expect(out[0].rationale).not.toContain("técnico");
  });
});
