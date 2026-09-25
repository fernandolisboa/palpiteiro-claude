import { describe, expect, it } from "vitest";

import {
  buildNarratorContext,
  buildNarratorMessage,
  checkNarrationFidelity,
  judgmentFactorPhrases,
  NarratorOutputSchema,
  templatedNarration,
  type NarratorDecision,
} from "@/lib/ai/markets/_narrator";
import { applyJudgments } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";

const TEAMS = { home: "CR Flamengo", away: "Fluminense FC" };

function overDecision(
  overrides: Partial<NarratorDecision> = {}
): NarratorDecision {
  return {
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    line: 2.5,
    teams: TEAMS,
    selectionKeys: ["over", "under"],
    side: "over",
    focus: {
      key: "over",
      label: "Mais de 2,5 gols (over 2,5)",
      modelProbPct: 58.4,
      impliedPct: 50.2,
      edgePct: 8.2,
      odd: 1.95,
    },
    stakeUnits: 2,
    minEdgePp: 5,
    expectedGoals: { home: 1.62, away: 1.1 },
    judgmentsApplied: true,
    judgmentFactors: [],
    ...overrides,
  };
}

function passDecision(): NarratorDecision {
  return overDecision({
    side: "pass",
    stakeUnits: null,
    focus: {
      key: "over",
      label: "Mais de 2,5 gols (over 2,5)",
      modelProbPct: 53.1,
      impliedPct: 50.2,
      edgePct: 2.9,
      odd: 1.95,
    },
  });
}

const OK = {
  rationale:
    "O modelo estima 58,4% para mais de 2,5 gols contra 50,2% implícitos na odd, um edge de 8,2 pp. Os dois ataques vêm marcando com frequência.",
  key_factors: ["Ataques produtivos", "Defesas vazadas"],
};

describe("NarratorOutputSchema (.strict)", () => {
  it("aceita só rationale + key_factors", () => {
    expect(NarratorOutputSchema.safeParse(OK).success).toBe(true);
  });

  it("rejeita campo extra (probabilidade ou lado)", () => {
    expect(
      NarratorOutputSchema.safeParse({ ...OK, confidence_pct: 70 }).success
    ).toBe(false);
    expect(
      NarratorOutputSchema.safeParse({ ...OK, recommendation: "under" }).success
    ).toBe(false);
  });

  it("rejeita rationale acima de 600 chars e key_factors fora de 2..5", () => {
    expect(
      NarratorOutputSchema.safeParse({ ...OK, rationale: "x".repeat(601) })
        .success
    ).toBe(false);
    expect(
      NarratorOutputSchema.safeParse({ ...OK, key_factors: ["só um"] }).success
    ).toBe(false);
    expect(
      NarratorOutputSchema.safeParse({
        ...OK,
        key_factors: ["a", "b", "c", "d", "e", "f"],
      }).success
    ).toBe(false);
  });
});

describe("checkNarrationFidelity", () => {
  it("texto fiel passa", () => {
    expect(checkNarrationFidelity(OK, overDecision())).toEqual({ ok: true });
  });

  it("percentual a ±1pp da decisão passa (arredondamento)", () => {
    const out = { ...OK, rationale: "O modelo vê 58% de chance de over." };
    expect(checkNarrationFidelity(out, overDecision()).ok).toBe(true);
  });

  it("percentual que diverge >1pp da prob/edge persistidos reprova", () => {
    const out = { ...OK, rationale: "O modelo estima 64% para o over." };
    const res = checkNarrationFidelity(out, overDecision());
    expect(res.ok).toBe(false);
  });

  it("edge citado em pp errado reprova", () => {
    const out = { ...OK, rationale: "Edge de 12,5 pp no over." };
    expect(checkNarrationFidelity(out, overDecision()).ok).toBe(false);
  });

  it("recomendar o outro lado reprova", () => {
    const out = {
      ...OK,
      rationale: "Apesar dos números, recomendamos o under neste jogo.",
    };
    const res = checkNarrationFidelity(out, overDecision());
    expect(res.ok).toBe(false);
  });

  it("negar o outro lado não é contradição", () => {
    const out = {
      ...OK,
      rationale: "Não recomendamos o under: o over tem valor claro.",
    };
    expect(checkNarrationFidelity(out, overDecision()).ok).toBe(true);
  });

  it("dizer 'sem aposta' numa aposta reprova", () => {
    const out = { ...OK, rationale: "Jogo sem aposta: melhor ficar de fora." };
    expect(checkNarrationFidelity(out, overDecision()).ok).toBe(false);
  });

  it("recomendar uma seleção num pass reprova", () => {
    const out = {
      ...OK,
      rationale: "O edge é pequeno, mas vale apostar no over mesmo assim.",
    };
    expect(checkNarrationFidelity(out, passDecision()).ok).toBe(false);
  });

  it("pass que explica o piso passa", () => {
    const out = {
      ...OK,
      rationale:
        "O modelo vê 53,1% para o over contra 50,2% implícitos: edge de 2,9 pp, abaixo do piso de 5 pp. Não há valor suficiente, e evitar apostar no over é o caminho.",
    };
    expect(checkNarrationFidelity(out, passDecision()).ok).toBe(true);
  });

  it("1X2: recomendar o visitante quando a decisão é o mandante reprova", () => {
    const decision: NarratorDecision = {
      ...overDecision(),
      marketKey: "match_result",
      marketLabel: "Resultado (1X2)",
      line: null,
      selectionKeys: ["home", "draw", "away"],
      side: "home",
      focus: {
        key: "home",
        label: "Vitória do CR Flamengo",
        modelProbPct: 55,
        impliedPct: 48,
        edgePct: 7,
        odd: 2,
      },
    };
    const out = {
      ...OK,
      rationale: "A aposta é na vitória do Fluminense FC fora de casa.",
    };
    expect(checkNarrationFidelity(out, decision).ok).toBe(false);
    const good = {
      ...OK,
      rationale: "Recomendamos a vitória do CR Flamengo, forte em casa.",
    };
    expect(checkNarrationFidelity(good, decision).ok).toBe(true);
  });
});

describe("templatedNarration", () => {
  it("é válido no schema e fiel à decisão (aposta e pass)", () => {
    for (const d of [overDecision(), passDecision()]) {
      const out = templatedNarration(d);
      expect(NarratorOutputSchema.safeParse(out).success).toBe(true);
      expect(checkNarrationFidelity(out, d)).toEqual({ ok: true });
    }
  });

  it("sem julgamentos aplicados, avisa que é só o estatístico", () => {
    const out = templatedNarration(overDecision({ judgmentsApplied: false }));
    expect(out.rationale).toMatch(/só o modelo estatístico/);
  });
});

describe("judgmentFactorPhrases", () => {
  const answers = (over: Partial<Record<string, number>>) =>
    Object.fromEntries(
      JUDGMENT_QUESTION_IDS.map((id) => [
        id,
        { value: over[id] ?? 0.2, confidence: null },
      ])
    ) as JudgmentAnswers;

  it("só os fatores que moveram λ, em PT-BR e sem números", () => {
    const a = answers({ attack_weakened_home: 0.9, rotation_risk_away: 0.6 });
    const applied = applyJudgments({ lambdaHome: 1.5, lambdaAway: 1.1 }, a);
    const phrases = judgmentFactorPhrases(a, applied.multipliers, TEAMS);
    expect(phrases).toHaveLength(2);
    expect(phrases[0]).toContain("CR Flamengo");
    expect(phrases[0]).toContain("sinal forte");
    expect(phrases[1]).toContain("Fluminense FC");
    expect(phrases.join(" ")).not.toMatch(/\d/);
  });

  it("JEV ausente → nenhum fator", () => {
    expect(judgmentFactorPhrases(null, null, TEAMS)).toEqual([]);
  });
});

describe("buildNarratorMessage", () => {
  it("leva a decisão e desfalques por função, nunca o nome do jogador", () => {
    const context = buildNarratorContext({
      league: "brasileirao_a",
      kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
      venue: "Maracanã",
      homeTeam: TEAMS.home,
      awayTeam: TEAMS.away,
      standings: undefined,
      homeForm: [],
      awayForm: [],
      h2h: [],
      absencesAvailable: true,
      absences: {
        home: [
          {
            injury: {
              player: { name: "Pedro Guilherme" },
              type: "injury",
              status: "injured",
            },
            position: "forward",
            isRegularStarter: true,
          },
        ],
        away: [],
      },
    });
    const msg = buildNarratorMessage(overDecision(), context);
    expect(msg).toContain("APOSTAR em Mais de 2,5 gols (over 2,5)");
    expect(msg).toContain("58,4%");
    expect(msg).toContain("atacante titular (lesionado)");
    expect(msg).not.toContain("Pedro");
  });

  it("pass diz SEM APOSTA", () => {
    const context = buildNarratorContext({
      league: "brasileirao_a",
      kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
      homeTeam: TEAMS.home,
      awayTeam: TEAMS.away,
      standings: undefined,
      homeForm: [],
      awayForm: [],
      h2h: [],
      absencesAvailable: false,
      absences: { home: [], away: [] },
    });
    const msg = buildNarratorMessage(passDecision(), context);
    expect(msg).toContain("SEM APOSTA");
    expect(msg).toContain("Desfalques: dados indisponíveis");
  });
});
