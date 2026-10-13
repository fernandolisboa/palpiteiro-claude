import { describe, expect, it } from "vitest";

import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { PredictionUserContext } from "@/lib/user-palpite/types";
import { toAnalysisUserContextView } from "@/lib/view/analysis-user-context";

const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const NOW = new Date("2026-05-20T12:00:00Z");

const answers = (v = 0.2) =>
  Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: v, confidence: null }]),
  ) as JudgmentAnswers;

const CONTEXT: PredictionUserContext = {
  claims: [
    {
      team: "home",
      topic: "absence",
      role: "attack",
      playersCount: 2,
      index: 0,
      status: "unverifiable",
      evidence: "1º citado: Não está na nossa lista de desfalques do Flamengo.",
      sides: [{ side: "home", status: "unverifiable" }],
      playerChecks: [
        { status: "unverifiable", questionId: "attack_weakened_home" },
        { status: "unverifiable", questionId: "attack_weakened_home" },
      ],
      signals: [{ questionId: "attack_weakened_home", strength: "unverified" }],
    },
    {
      team: "away",
      topic: "form",
      direction: "good",
      index: 1,
      status: "contradicted",
      evidence: "Últimos 5 jogos do Palmeiras: 1V 2E 2D.",
      sides: [{ side: "away", status: "contradicted" }],
      playerChecks: [],
      signals: [],
    },
  ],
  evidence: { attack_weakened_home: 0.7 },
  extractionAiCallId: "ac-x",
  warnings: [],
  versions: { userEvidence: "user_evidence_v1", extract: "user_palpite_extract_v1" },
};

function judgments(over: Partial<PredictionJudgments> = {}): PredictionJudgments {
  return {
    engine: "code_jev",
    applied: true,
    answers: answers(),
    multipliers: null,
    lambda: {
      source: "heuristic",
      degraded: false,
      rho: null,
      base: { home: 1.5, away: 1.1 },
      adjusted: { home: 1.4, away: 1.1 },
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
    ...over,
  };
}

const row = (marketKey: string, hoursAgo: number, j: PredictionJudgments | null) =>
  ({
    marketKey,
    prediction: {
      createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
      judgments: j,
    },
  }) as never;

describe("toAnalysisUserContextView", () => {
  it("mapeia as afirmações pelo texto do código, com status, evidência e efeito", () => {
    const view = toAnalysisUserContextView(
      [row("match_result", 1, judgments({ userContext: CONTEXT }))],
      TEAMS,
      NOW,
    );
    expect(view).not.toBeNull();
    expect(view!.claims).toEqual([
      {
        index: 0,
        text: "desfalque no ataque do Flamengo (2 jogadores citados)",
        topicLabel: "desfalque",
        status: "unverifiable",
        statusLabel: "não verificável",
        evidence: "1º citado: Não está na nossa lista de desfalques do Flamengo.",
        effect: "efeito no modelo: ataque do Flamengo ajustado para baixo",
      },
      {
        index: 1,
        text: "Palmeiras em boa fase",
        topicLabel: "momento",
        status: "contradicted",
        statusLabel: "contradita",
        evidence: "Últimos 5 jogos do Palmeiras: 1V 2E 2D.",
        effect: "sem efeito no modelo",
      },
    ]);
    expect(view!.showUnverifiedNote).toBe(true);
    expect(view!.createdAgo).toBeTruthy();
  });

  it("JEV já mais forte: \"já considerado\" e sem a nota de não verificável", () => {
    const view = toAnalysisUserContextView(
      [
        row(
          "match_result",
          1,
          judgments({ answers: answers(0.9), userContext: CONTEXT }),
        ),
      ],
      TEAMS,
      NOW,
    );
    expect(view!.claims[0].effect).toBe("já considerado pelo modelo");
    expect(view!.showUnverifiedNote).toBe(false);
  });

  it("reanálise de uma seção sem contexto esconde o contexto antigo", () => {
    const view = toAnalysisUserContextView(
      [
        row("btts", 0.5, judgments()),
        row("match_result", 2, judgments({ userContext: CONTEXT })),
        row("btts", 2, judgments({ userContext: CONTEXT })),
      ],
      TEAMS,
      NOW,
    );
    expect(view).toBeNull();
  });

  it("sem row code_jev ou sem contexto → null", () => {
    expect(toAnalysisUserContextView([row("correct_score", 1, null)], TEAMS, NOW)).toBeNull();
    expect(toAnalysisUserContextView([], TEAMS, NOW)).toBeNull();
  });
});
