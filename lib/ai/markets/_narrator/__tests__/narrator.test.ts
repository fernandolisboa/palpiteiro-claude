import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildNarratorContext,
  buildNarratorMessage,
  checkNarrationFidelity,
  fidelityRejectionFeedback,
  judgmentFactorPhrases,
  lineupNotePhrases,
  NARRATOR_VERSION,
  narratorCartridge,
  NarratorOutputSchema,
  rejectionBlock,
  SUBMIT_NARRATION_TOOL,
  SYSTEM_PROMPT,
  templatedNarration,
  withRejection,
  zodRejectionFeedback,
  type NarratorDecision,
} from "@/lib/ai/markets/_narrator";
import { KEY_FACTOR_MAX_CHARS } from "@/lib/ai/markets/_narrator/prompt";
import { applyJudgments } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

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
    selections: [
      { key: "over", label: "Mais de 2,5 gols (over 2,5)", modelProbPct: 58.4, impliedPct: 50.2 },
      { key: "under", label: "Menos de 2,5 gols (under 2,5)", modelProbPct: 41.6, impliedPct: 49.8 },
    ],
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
    selections: [
      { key: "over", label: "Mais de 2,5 gols (over 2,5)", modelProbPct: 53.1, impliedPct: 50.2 },
      { key: "under", label: "Menos de 2,5 gols (under 2,5)", modelProbPct: 46.9, impliedPct: 49.8 },
    ],
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

  it("número colado a outro não é lido pelo sufixo (borda esquerda)", () => {
    // Sem a borda, "1058,4%" casava "058,4%" = 58,4 (a prob persistida) e passava.
    const out = { ...OK, rationale: "O modelo estima 1058,4% para o over." };
    expect(checkNarrationFidelity(out, overDecision()).ok).toBe(false);
  });

  it("percentual colado a pontuação (não a dígito) segue checado", () => {
    // "42%" depois de "58%," e "58%" depois de "over." são citações independentes.
    const bad = { ...OK, rationale: "Modelo: 58,4%,64% no over." };
    expect(checkNarrationFidelity(bad, overDecision()).ok).toBe(false);
    const bad2 = { ...OK, rationale: "Leitura do over.64% de chance." };
    expect(checkNarrationFidelity(bad2, overDecision()).ok).toBe(false);
    const good = {
      ...OK,
      rationale: "Leitura do over.58,4% contra 50,2%,8,2 pp.",
    };
    expect(checkNarrationFidelity(good, overDecision()).ok).toBe(true);
  });

  it("2 vias: o complemento da prob do modelo ou da implícita é citação fiel", () => {
    const out = {
      ...OK,
      rationale:
        "O modelo dá 41,6% ao under, contra 49,8% implícitos nele: o over tem valor.",
    };
    expect(checkNarrationFidelity(out, overDecision()).ok).toBe(true);
  });

  it("3 vias: complemento NÃO é aceito (não há lado único oposto)", () => {
    const decision: NarratorDecision = {
      ...overDecision(),
      marketKey: "match_result",
      marketLabel: "Resultado (1X2)",
      line: null,
      selectionKeys: ["home", "draw", "away"],
      selections: [
        { key: "home", label: "Vitória do CR Flamengo", modelProbPct: 55, impliedPct: 40 },
        { key: "draw", label: "Empate", modelProbPct: 25, impliedPct: 30 },
        { key: "away", label: "Vitória do Fluminense FC", modelProbPct: 20, impliedPct: 30 },
      ],
      side: "home",
      focus: {
        key: "home",
        label: "Vitória do CR Flamengo",
        modelProbPct: 55,
        impliedPct: 40,
        edgePct: 15,
        odd: 2.4,
      },
    };
    const out = {
      ...OK,
      rationale: "O CR Flamengo não vence em 45% dos cenários.",
    };
    expect(checkNarrationFidelity(out, decision).ok).toBe(false);
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

  describe("falsos positivos do code review (conservador: na dúvida, passa)", () => {
    const withText = (rationale: string) => ({ ...OK, rationale });

    it("pass + 'a aposta no over não se paga' passa (negação depois do rótulo)", () => {
      expect(
        checkNarrationFidelity(
          withText("A aposta no over não se paga com essa odd."),
          passDecision()
        ).ok
      ).toBe(true);
      for (const tail of ["não tem valor", "não compensa", "fica sem valor"]) {
        expect(
          checkNarrationFidelity(
            withText(`Apostar no under ${tail} aqui.`),
            passDecision()
          ).ok
        ).toBe(true);
      }
    });

    it("aposta no over + 'não há valor no under' passa (sem-aposta amarrado a outra seleção)", () => {
      expect(
        checkNarrationFidelity(
          withText("Não há valor no under; o over é o lado certo."),
          overDecision()
        ).ok
      ).toBe(true);
    });

    it("BTTS sim + 'palpite não é garantia' passa (sem apelido 'não' solto)", () => {
      const decision = overDecision({
        marketKey: "btts",
        marketLabel: "Ambas marcam",
        line: null,
        selectionKeys: ["yes", "no"],
        side: "yes",
        focus: {
          key: "yes",
          label: "Ambas marcam: sim",
          modelProbPct: 58.4,
          impliedPct: 50.2,
          edgePct: 8.2,
          odd: 1.95,
        },
      });
      expect(
        checkNarrationFidelity(
          withText("Palpite não é garantia: os dois ataques marcam muito."),
          decision
        ).ok
      ).toBe(true);
      expect(
        checkNarrationFidelity(
          withText("Recomendamos ambas marcam: não neste jogo."),
          decision
        ).ok
      ).toBe(false);
    });

    it("1X2 mandante + visitante só mencionado ('a aposta do Bahia fora') passa", () => {
      const decision: NarratorDecision = overDecision({
        marketKey: "match_result",
        marketLabel: "Resultado (1X2)",
        line: null,
        teams: { home: "Fortaleza", away: "Bahia" },
        selectionKeys: ["home", "draw", "away"],
        side: "home",
        focus: {
          key: "home",
          label: "Vitória do Fortaleza",
          modelProbPct: 55,
          impliedPct: 48,
          edgePct: 7,
          odd: 2,
        },
      });
      expect(
        checkNarrationFidelity(
          withText(
            "A aposta do Bahia fora de casa tem rendido pouco; o Fortaleza é forte em casa."
          ),
          decision
        ).ok
      ).toBe(true);
    });

    it("aposta no over + 'o under é a melhor escolha' reprova (recomendação com o rótulo antes)", () => {
      expect(
        checkNarrationFidelity(
          withText("O under é a melhor escolha neste jogo."),
          overDecision()
        ).ok
      ).toBe(false);
      expect(
        checkNarrationFidelity(
          withText("O under vale a aposta."),
          overDecision()
        ).ok
      ).toBe(false);
      expect(
        checkNarrationFidelity(
          withText("Não achamos que o under é a melhor escolha."),
          overDecision()
        ).ok
      ).toBe(true);
    });
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

  describe("contexto extra do usuário (#565)", () => {
    it("fator movido só pelo usuário: origem na frase, sem força (o JEV não o moveu)", () => {
      const jev = answers({ attack_weakened_away: 0.9 });
      // JEV ∨ usuário: o usuário pôs 0,7 (não verificável) no ataque do mandante.
      const combined = { ...jev, attack_weakened_home: { value: 0.7, confidence: null } };
      const applied = applyJudgments({ lambdaHome: 1.5, lambdaAway: 1.1 }, combined);
      const phrases = judgmentFactorPhrases(combined, applied.multipliers, TEAMS, {
        jev,
        origins: { attack_weakened_home: "unverified" },
      });
      expect(phrases).toEqual([
        "Desfalques ou titulares poupados tiram do CR Flamengo uma peça ofensiva central (ataque do CR Flamengo ajustado para baixo) (informado por você, não conferido)",
        "Desfalques ou titulares poupados tiram do Fluminense FC uma peça ofensiva central (ataque do Fluminense FC ajustado para baixo) — sinal forte",
      ]);
    });

    it("a força vem do JEV, nunca do noul do usuário; confirmada vira \"(informado por você)\"", () => {
      const jev = answers({ rotation_risk_home: 0.6 });
      const combined = { ...jev, rotation_risk_home: { value: 0.85, confidence: null } };
      const applied = applyJudgments({ lambdaHome: 1.5, lambdaAway: 1.1 }, combined);
      const [phrase] = judgmentFactorPhrases(combined, applied.multipliers, TEAMS, {
        jev,
        origins: { rotation_risk_home: "confirmed" },
      });
      expect(phrase).toContain("— sinal moderado (informado por você)");
      expect(phrase).not.toContain("sinal forte");
      expect(phrase).not.toMatch(/\d/);
    });

    it("JEV que falhou (null): a frase do usuário sai sem força", () => {
      const combined = answers({ attack_weakened_home: 0.7 });
      const applied = applyJudgments({ lambdaHome: 1.5, lambdaAway: 1.1 }, combined);
      const phrases = judgmentFactorPhrases(combined, applied.multipliers, TEAMS, {
        jev: null,
        origins: { attack_weakened_home: "unverified" },
      });
      expect(phrases).toHaveLength(1);
      expect(phrases[0]).toMatch(/ajustado para baixo\) \(informado por você, não conferido\)$/);
    });

    it("narrator_v1.2+: a regra 4 explica as duas origens e as notas", () => {
      expect(NARRATOR_VERSION).toBe("narrator_v1.5");
      expect(SYSTEM_PROMPT).toContain('"(informado por você, não conferido)"');
      expect(SYSTEM_PROMPT).toContain("nunca como fato confirmado");
      expect(SYSTEM_PROMPT).toContain('Os itens do bloco "Informado por você"');
      expect(SYSTEM_PROMPT).toContain("não mudaram nenhum número: cite-os uma vez");
    });

    it("a fidelidade aceita a narração que cita a origem", () => {
      const d = overDecision({
        judgmentFactors: [
          "Desfalques ou titulares poupados tiram do CR Flamengo uma peça ofensiva central (ataque do CR Flamengo ajustado para baixo) (informado por você, não conferido)",
        ],
      });
      const out = {
        rationale:
          "Segundo o que você informou, o CR Flamengo perde uma peça no ataque, e o modelo estima 58,4% para mais de 2,5 gols.",
        key_factors: ["Desfalque no ataque do CR Flamengo (informado por você, não conferido)", "Edge de 8,2 pp"],
      };
      expect(checkNarrationFidelity(out, d).ok).toBe(true);
    });

    it("templatedNarration leva a origem pros key_factors", () => {
      const out = templatedNarration(
        overDecision({
          judgmentFactors: [
            "Desfalques ou titulares poupados tiram do CR Flamengo uma peça ofensiva central (ataque do CR Flamengo ajustado para baixo) (informado por você, não conferido)",
          ],
        })
      );
      expect(out.key_factors.join(" ")).toContain("(informado por você, não conferido)");
    });
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

  describe("notas do contexto extra (#569)", () => {
    const context = () =>
      buildNarratorContext({
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

    it("sem nota a mensagem é a mesma de antes (sem a seção)", () => {
      const before = buildNarratorMessage(overDecision(), context());
      expect(buildNarratorMessage(overDecision({ userNotes: [] }), context())).toBe(before);
      expect(before).not.toContain("Informado por você");
    });

    it("com nota, a seção vem depois dos fatores, uma linha marcada por nota", () => {
      const msg = buildNarratorMessage(
        overDecision({ userNotes: ["troca de técnico no CR Flamengo", "clássico entre os dois times"] }),
        context(),
      );
      expect(msg).toContain(
        "## Informado por você (não conferido, sem efeito nos números)\n- troca de técnico no CR Flamengo (informado por você, não conferido)\n- clássico entre os dois times (informado por você, não conferido)\n\n## Contexto",
      );
      expect(msg.indexOf("## Fatores qualitativos")).toBeLessThan(msg.indexOf("## Informado por você"));
    });

    it("o template registra a nota no racional, sem mexer nos key_factors", () => {
      const plain = templatedNarration(overDecision());
      const out = templatedNarration(overDecision({ userNotes: ["troca de técnico no CR Flamengo"] }));
      expect(out.rationale).toBe(
        `${plain.rationale} Você também informou (não conferido, sem efeito nos números): troca de técnico no CR Flamengo.`,
      );
      expect(out.key_factors).toEqual(plain.key_factors);
    });

    it("o template nunca corta a nota no meio: sem espaço, fica de fora", () => {
      const plain = templatedNarration(overDecision());
      const out = templatedNarration(overDecision({ userNotes: ["x".repeat(600)] }));
      expect(out.rationale).toBe(plain.rationale);
    });

    it("o template põe as notas que cabem, uma a uma", () => {
      const plain = templatedNarration(overDecision());
      const out = templatedNarration(
        overDecision({ userNotes: ["clássico entre os dois times", "x".repeat(600)] }),
      );
      expect(out.rationale).toBe(
        `${plain.rationale} Você também informou (não conferido, sem efeito nos números): clássico entre os dois times.`,
      );
      expect(out.rationale.length).toBeLessThanOrEqual(600);
    });
  });
});

describe("forma recente por competição (#618)", () => {
  const fx = (
    id: string,
    home: string,
    away: string,
    score: [number, number],
    iso: string,
    competition?: NormalizedFixture["competition"]
  ): NormalizedFixture => ({
    id,
    league: "brasileirao_a",
    kickoffAt: iso,
    kickoffTimestampMs: Date.parse(iso),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: score[0], away: score[1] },
    ...(competition ? { competition } : {}),
  });

  const context = (homeForm: NormalizedFixture[]) =>
    buildNarratorContext({
      league: "brasileirao_a",
      kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
      homeTeam: TEAMS.home,
      awayTeam: TEAMS.away,
      standings: undefined,
      homeForm,
      awayForm: [],
      h2h: [],
      absencesAvailable: false,
      absences: { home: [], away: [] },
    });

  it("tira amistoso e rotula jogo de outra competição", () => {
    const c = context([
      fx("1", TEAMS.home, "EC Bahia", [2, 1], "2026-05-10T19:00:00.000Z", {
        name: "Serie A",
        league: "brasileirao_a",
        friendly: false,
      }),
      fx("2", "Ceará SC", TEAMS.home, [0, 0], "2026-05-06T22:00:00.000Z", {
        name: "Copa Do Brasil",
        friendly: false,
      }),
      fx("3", TEAMS.home, "Racing Club", [1, 2], "2026-05-03T22:00:00.000Z", {
        name: "CONMEBOL Libertadores",
        league: "copa_libertadores",
        friendly: false,
      }),
      fx("4", TEAMS.home, "Benfica", [0, 3], "2026-04-30T19:00:00.000Z", {
        name: "Friendlies Clubs",
        friendly: true,
      }),
    ]);
    expect(c.form.home).toEqual([
      "V 2-1 x EC Bahia (casa)",
      "E 0-0 x Ceará SC (fora, Copa Do Brasil)",
      "D 1-2 x Racing Club (casa, Libertadores)",
    ]);
    const msg = buildNarratorMessage(overDecision(), c);
    expect(msg).toContain(
      "- Forma recente (mais recente primeiro, sem amistosos; jogo de outra competição traz o nome dela):"
    );
    expect(msg).not.toContain("Benfica");
  });

  it("sem competição de origem (cache antigo) a linha é a de antes", () => {
    const c = context([
      fx("1", TEAMS.home, "EC Bahia", [2, 1], "2026-05-10T19:00:00.000Z"),
    ]);
    expect(c.form.home).toEqual(["V 2-1 x EC Bahia (casa)"]);
  });
});

describe("escalação confirmada na reconferência (#619)", () => {
  const announced = (
    changes: "0-2" | "3-4" | "5+" | null,
    leftOut: { position?: "goalkeeper" | "defender" | "midfielder" | "forward"; whereabouts?: "bench" | "out_of_squad" }[] = []
  ) => ({ status: "announced" as const, changes, leftOut });

  it("uma frase por time anunciado, com papéis (sem nome) e desfalcados no XI", () => {
    const phrases = lineupNotePhrases(
      {
        home: announced("5+", [
          { position: "goalkeeper", whereabouts: "bench" },
          { position: "defender", whereabouts: "out_of_squad" },
          { position: "midfielder" },
          { whereabouts: "bench" },
        ]),
        away: announced(null),
      },
      TEAMS,
      { home: 0, away: 2 }
    );
    expect(phrases).toEqual([
      `Escalação: ${TEAMS.home} com 5 ou mais mudanças por escolha em relação ao time titular habitual (goleiro titular no banco, defensor titular fora da lista, meio-campista titular e mais 1)`,
      `Escalação: ${TEAMS.away} sem comparação com o time titular habitual; 2 jogadores listados como desfalque estão entre os titulares`,
    ]);
  });

  it("time sem escalação anunciada não gera frase", () => {
    expect(
      lineupNotePhrases(
        { home: { status: "not_announced" }, away: announced("0-2") },
        TEAMS
      )
    ).toEqual([
      `Escalação: ${TEAMS.away} com 0 a 2 mudanças por escolha em relação ao time titular habitual`,
    ]);
  });

  it("template: notas abrem o racional e vêm DEPOIS de prob./edge nos fatores", () => {
    const notes = ["Escalação: A com 0 a 2 mudanças", "Escalação: B com 3 a 4 mudanças"];
    const out = templatedNarration(
      overDecision({ lineupNotes: notes, judgmentFactors: ["fator JEV"] })
    );
    expect(
      out.rationale.startsWith(
        "Escalação: A com 0 a 2 mudanças. Escalação: B com 3 a 4 mudanças. O modelo"
      )
    ).toBe(true);
    expect(out.key_factors).toEqual([
      "Probabilidade do modelo: 58,4%",
      "Edge: 8,2 pp",
      ...notes,
      "fator JEV",
    ]);
    expect(NarratorOutputSchema.safeParse(out).success).toBe(true);
    expect(checkNarrationFidelity(out, overDecision({ lineupNotes: notes }))).toEqual({ ok: true });
  });

  it("nota longa demais não corta os números do racional (fica só nos fatores, cortada)", () => {
    const plain = templatedNarration(overDecision());
    const out = templatedNarration(overDecision({ lineupNotes: ["x".repeat(590)] }));
    expect(out.rationale).toBe(plain.rationale);
    const note = out.key_factors.find((f) => f.startsWith("xxx"));
    expect(note).toBe(`${"x".repeat(KEY_FACTOR_MAX_CHARS - 1)}…`);
    expect(NarratorOutputSchema.safeParse(out).success).toBe(true);
  });

  it("frase longa: cita menos papéis pra caber no limite do fator", () => {
    // 20 caracteres: a frase com 1 papel tem 200 (cabe); com 2 ou mais, não.
    const longTeam = "Grêmio Novorizontino";
    const [phrase] = lineupNotePhrases(
      {
        home: announced("5+", [
          { position: "goalkeeper", whereabouts: "bench" },
          { position: "defender", whereabouts: "out_of_squad" },
          { position: "midfielder", whereabouts: "out_of_squad" },
          { position: "forward", whereabouts: "out_of_squad" },
        ]),
        away: { status: "not_announced" },
      },
      { home: longTeam, away: TEAMS.away },
      { home: 2, away: 0 }
    );
    expect(phrase.length).toBeLessThanOrEqual(KEY_FACTOR_MAX_CHARS);
    expect(phrase.startsWith(`Escalação: ${longTeam} com 5 ou mais mudanças`)).toBe(true);
    expect(phrase).toContain("(goleiro titular no banco e mais 3)");
    expect(phrase.endsWith("2 jogadores listados como desfalque estão entre os titulares")).toBe(true);
  });

  it("o narrador LLM nunca lê as notas (mensagem idêntica, sem bump)", () => {
    const ctx = buildNarratorContext({
      league: "brasileirao_a",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
      homeTeam: TEAMS.home,
      awayTeam: TEAMS.away,
      standings: undefined,
      homeForm: [],
      awayForm: [],
      h2h: [],
      absencesAvailable: false,
      absences: { home: [], away: [] },
    });
    expect(buildNarratorMessage(overDecision({ lineupNotes: ["Escalação X"] }), ctx)).toBe(
      buildNarratorMessage(overDecision(), ctx)
    );
  });
});

// #669 (Palmeiras x Flamengo, 2026-11-21): num 1X2 o código decidiu o mandante pelo
// preço e a narração caiu no texto padrão. Causa provável: o texto citava a chance do
// favorito (o visitante), que não estava no bloco "Decisão", e a fidelidade reprovava.
describe("narrator_v1.5 (#669): todas as seleções na decisão e 2ª tentativa", () => {
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  const CTX = buildNarratorContext({
    league: "brasileirao_a",
    kickoffAt: new Date("2026-05-15T19:00:00Z"),
    homeTeam: TEAMS.home,
    awayTeam: TEAMS.away,
    standings: undefined,
    homeForm: [],
    awayForm: [],
    h2h: [],
    absencesAvailable: false,
    absences: { home: [], away: [] },
  });
  const LAST_LINE =
    "Escreva o racional e os fatores-chave desta decisão via submit_narration.";

  // O mercado vê o visitante como favorito; o modelo acha valor no mandante.
  function homeByPrice(overrides: Partial<NarratorDecision> = {}): NarratorDecision {
    return overDecision({
      marketKey: "match_result",
      marketLabel: "Resultado (1X2)",
      line: null,
      selectionKeys: ["home", "draw", "away"],
      selections: [
        { key: "home", label: "Vitória do CR Flamengo", modelProbPct: 38.5, impliedPct: 31.2 },
        { key: "draw", label: "Empate", modelProbPct: 27.1, impliedPct: 29 },
        { key: "away", label: "Vitória do Fluminense FC", modelProbPct: 34.4, impliedPct: 39.8 },
      ],
      side: "home",
      focus: {
        key: "home",
        label: "Vitória do CR Flamengo",
        modelProbPct: 38.5,
        impliedPct: 31.2,
        edgePct: 7.3,
        odd: 3.1,
      },
      ...overrides,
    });
  }

  it("versão nova; system e tool byte-idênticos aos da v1.4 (cache, ADR 0071)", () => {
    expect(NARRATOR_VERSION).toBe("narrator_v1.5");
    expect(narratorCartridge.version).toBe("narrator_v1.5");
    // Literais calculados no código da narrator_v1.4, antes da mudança.
    expect(sha256(SYSTEM_PROMPT)).toBe(
      "44474ddf2f778d6bf327cad4bd06c83bc15f412b30cb80f63113ca0b55757269"
    );
    expect(sha256(JSON.stringify(SUBMIT_NARRATION_TOOL))).toBe(
      "bc9ae9c6d42d369caea9414f82c0d83a34dca74c385b73d10e9dcaa71c200638"
    );
    expect(sha256(JSON.stringify(narratorCartridge.tool))).toBe(
      "1352aaf02a8249a1c8859dbd190ee13e631dbaf5dbb72097a001a381eaeeb1dc"
    );
  });

  it("1X2: as três seleções entram DENTRO do bloco Decisão, com modelo e implícita", () => {
    const msg = buildNarratorMessage(homeByPrice(), CTX);
    const decisionBlock = msg.slice(
      msg.indexOf("## Decisão"),
      msg.indexOf("## Fatores qualitativos")
    );
    expect(decisionBlock).toContain(
      "- Chances de cada seleção (modelo · implícita na odd, sem margem):"
    );
    expect(decisionBlock).toContain("  - Vitória do CR Flamengo: 38,5% · 31,2%");
    expect(decisionBlock).toContain("  - Empate: 27,1% · 29,0%");
    expect(decisionBlock).toContain("  - Vitória do Fluminense FC: 34,4% · 39,8%");
    expect(decisionBlock).toContain("não aponta quem é o favorito");
    // O edge citável continua sendo só o do focus.
    expect(decisionBlock.match(/Edge:/g)).toHaveLength(1);
  });

  it("seleção sem odd sai como 'sem odd'; sem seleções, nenhuma linha", () => {
    const d = homeByPrice({
      selections: [
        { key: "home", label: "Vitória do CR Flamengo", modelProbPct: 38.5, impliedPct: 31.2 },
        { key: "draw", label: "Empate", modelProbPct: 27.1, impliedPct: null },
      ],
    });
    expect(buildNarratorMessage(d, CTX)).toContain("  - Empate: 27,1% · sem odd");
    expect(buildNarratorMessage(homeByPrice({ selections: [] }), CTX)).not.toContain(
      "Chances de cada seleção"
    );
  });

  it("fidelidade: aceita a chance do favorito e a implícita do empate", () => {
    const out = {
      rationale:
        "O Fluminense FC chega como favorito do mercado, com 39,8% implícitos, e o modelo lhe dá 34,4%; o empate tem 29,0% implícitos. Para o CR Flamengo o modelo vê 38,5% contra 31,2%: edge de 7,3 pp.",
      key_factors: ["Mandante subvalorizado pelo preço", "Visitante favorito no mercado"],
    };
    expect(checkNarrationFidelity(out, homeByPrice())).toEqual({ ok: true });
  });

  it("fidelidade: número fora da decisão segue reprovando, e o edge das outras não vale", () => {
    const off = {
      rationale: "O empate tem 45% de chance pelo modelo.",
      key_factors: ["a", "b"],
    };
    expect(checkNarrationFidelity(off, homeByPrice()).ok).toBe(false);
    // Edge do empate (27,1 − 29,0 = −1,9) não está no bloco.
    const edgeDraw = {
      rationale: "O empate fica 1,9 pp abaixo do preço.",
      key_factors: ["a", "b"],
    };
    expect(checkNarrationFidelity(edgeDraw, homeByPrice()).ok).toBe(false);
  });

  describe("fidelidade: o percentual fica amarrado à seleção citada na frase (code review)", () => {
    const say = (rationale: string) => ({ rationale, key_factors: ["a", "b"] });

    it("reprova o número de outra seleção na frase do mandante", () => {
      const res = checkNarrationFidelity(say("O CR Flamengo tem 34,4% de chance."), homeByPrice());
      expect(res.ok).toBe(false);
      if (res.ok) return;
      // error_message com a chave crua; o retorno pro modelo com o rótulo que ele leu.
      expect(res.reason).toContain("não bate com 'home', citada na mesma frase [");
      expect(res.feedback).toBe(
        "percentual citado 34,4% não bate com os números de 'Vitória do CR Flamengo', citada na mesma frase"
      );
    });

    it("reprova a implícita apresentada como chance do modelo", () => {
      for (const text of [
        "O modelo dá 39,8% ao Fluminense FC.",
        // Sem o rótulo completo: cai na lista do modelo, onde 39,8 não está.
        "O modelo dá 39,8% ao Fluminense.",
      ]) {
        const res = checkNarrationFidelity(say(text), homeByPrice());
        expect(res.ok, text).toBe(false);
        if (!res.ok) expect(res.reason).toContain("como chance do modelo");
      }
    });

    it("aceita a chance do modelo do favorito, a implícita do empate e o focus com edge e piso", () => {
      for (const text of [
        "O modelo dá 34,4% ao Fluminense FC.",
        "O mercado dá 39,8% ao Fluminense FC.",
        "O empate tem 29,0% implícitos.",
        "Para o CR Flamengo o modelo vê 38,5% contra 31,2%: edge de 7,3 pp, acima do piso de 5 pp.",
        // Duas seleções na frase: vale o número de qualquer uma.
        "O Fluminense FC é o favorito do mercado, mas o modelo vê 38,5% para o CR Flamengo.",
        // Papel ("mandante"/"visitante") também liga o número à seleção.
        "O Fluminense FC é favorito do mercado, mas o modelo vê 38,5% para o mandante.",
        // Sem seleção na frase: a lista global.
        "O favorito do mercado aparece com 39,8% implícitos.",
      ]) {
        expect(checkNarrationFidelity(say(text), homeByPrice()), text).toEqual({ ok: true });
      }
    });
  });

  it("feedback do lado usa os rótulos; o reason segue com as chaves cruas", () => {
    const res = checkNarrationFidelity(
      { rationale: "O mercado aposta no Fluminense FC.", key_factors: ["a", "b"] },
      homeByPrice()
    );
    expect(res).toEqual({
      ok: false,
      reason: "texto recomenda 'away', mas a decisão é 'home'",
      feedback: "texto recomenda 'Vitória do Fluminense FC', mas a decisão é 'Vitória do CR Flamengo'",
    });
    const draw = checkNarrationFidelity(
      { rationale: "Jogo sem aposta.", key_factors: ["a", "b"] },
      homeByPrice({ side: "draw" })
    );
    expect(draw).toEqual({
      ok: false,
      reason: "texto diz que não há aposta, mas a decisão é 'draw'",
      feedback: "texto diz que não há aposta, mas a decisão é 'Empate'",
    });
  });

  it("fidelidade: 'o mercado aposta no favorito' continua sendo recomendação da outra seleção", () => {
    const out = {
      rationale: "O mercado aposta no Fluminense FC, mas o modelo vê valor no mandante.",
      key_factors: ["a", "b"],
    };
    const res = checkNarrationFidelity(out, homeByPrice());
    expect(res.ok).toBe(false);
  });

  it("2ª tentativa: o bloco de reprovação entra antes da última linha, que segue igual", () => {
    const msg = buildNarratorMessage(homeByPrice(), CTX);
    expect(msg.split("\n").at(-1)).toBe(LAST_LINE);
    const retry = withRejection(
      msg,
      rejectionBlock("fidelity", "percentual citado 64% não bate com a decisão persistida")
    );
    expect(retry.split("\n").at(-1)).toBe(LAST_LINE);
    expect(retry.startsWith(msg.slice(0, msg.lastIndexOf("\n")))).toBe(true);
    expect(retry).toContain(
      [
        "",
        "## Tentativa anterior reprovada",
        "- A resposta anterior não passou na conferência com os números e o lado da decisão: percentual citado 64% não bate com a decisão persistida.",
        "- Escreva de novo seguindo as regras e o formato. A decisão e os números não mudaram.",
        "",
        LAST_LINE,
      ].join("\n")
    );
    expect(rejectionBlock("format", "x")[1]).toBe(
      "- A resposta anterior veio fora do formato pedido: x."
    );
  });

  it("feedback: Zod em 'caminho: mensagem' até 500 caracteres; fidelidade sem a lista do fim", () => {
    const parsed = NarratorOutputSchema.safeParse({ rationale: "", key_factors: ["só um"] });
    expect(parsed.success).toBe(false);
    const zod = zodRejectionFeedback(parsed.error!.issues);
    expect(zod).toMatch(/^rationale: .+; key_factors: .+/);
    const long = zodRejectionFeedback(
      Array.from({ length: 40 }, (_, i) => ({ path: ["k", i], message: "x".repeat(30) }))
    );
    expect(long.length).toBe(500);
    expect(
      fidelityRejectionFeedback(
        "percentual citado 64% não bate com a decisão persistida [5.00, 58.40, 50.20]"
      )
    ).toBe("percentual citado 64% não bate com a decisão persistida");
    expect(fidelityRejectionFeedback("texto recomenda 'away', mas a decisão é 'home'")).toBe(
      "texto recomenda 'away', mas a decisão é 'home'"
    );
  });
});
