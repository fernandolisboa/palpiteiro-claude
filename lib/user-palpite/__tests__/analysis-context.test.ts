import { describe, expect, it } from "vitest";

import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { enrichAbsences } from "@/lib/ai/judgments/state";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import {
  CONTEXT_APPLIED_NOTICE,
  CONTEXT_EMPTY_NOTICE,
  CONTEXT_FAILED_NOTICE,
  CONTEXT_NO_EFFECT_NOTICE,
  CONTEXT_NOT_USED_NOTICE,
  CONTEXT_NOTED_NOTICE,
  analysisContextNotice,
  applyUserClaims,
  factsFromAnalysisData,
  pickUserContext,
  toStoredContextClaim,
} from "@/lib/user-palpite/analysis-context";
import {
  claimDescription,
  claimTopicLabel,
  contextNotes,
  hasContextNote,
} from "@/lib/user-palpite/labels";
import {
  ClaimSchema,
  PredictionUserContextSchema,
  StoredClaimsSchema,
  type CheckedClaim,
  type Claim,
  type PredictionUserContext,
} from "@/lib/user-palpite/types";

const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const KICKOFF = new Date("2026-05-20T19:00:00Z");

function answers(over: Partial<Record<string, number>> = {}): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: over[id] ?? 0.2, confidence: null }]),
  ) as JudgmentAnswers;
}

const NO_FACTS = factsFromAnalysisData({
  absences: null,
  homeForm: [],
  awayForm: [],
  standings: undefined,
});

function apply(claims: Claim[], jev: JudgmentAnswers | null, facts = NO_FACTS) {
  return applyUserClaims({
    claims,
    facts,
    teams: TEAMS,
    league: "brasileirao_a",
    kickoffAt: KICKOFF,
    jev,
    extractionAiCallId: "ai-x",
    warnings: [],
    extractVersion: "user_palpite_extract_v1",
  });
}

const ATTACK_HOME: Claim = {
  team: "home",
  topic: "absence",
  text: "o Flamengo está sem o Pedro",
  players: ["Pedro Guilherme"],
  role: "attack",
};

describe("toStoredContextClaim", () => {
  it("tira a paráfrase e os nomes; fica a contagem e os status por jogador", () => {
    const checked: CheckedClaim = {
      ...ATTACK_HOME,
      players: ["Pedro Guilherme", "Bruno Henrique"],
      index: 0,
      status: "unverifiable",
      evidence: "1º citado: Não está na nossa lista de desfalques do Flamengo.",
      sides: [{ side: "home", status: "unverifiable" }],
      playerChecks: [
        { name: "Pedro Guilherme", status: "unverifiable", questionId: "attack_weakened_home" },
        { name: "Bruno Henrique", status: "confirmed", questionId: "attack_weakened_home" },
      ],
      signals: [{ questionId: "attack_weakened_home", strength: "unverified" }],
    };
    const stored = toStoredContextClaim(checked);
    const json = JSON.stringify(stored);
    expect(json).not.toContain("Pedro");
    expect(json).not.toContain("Bruno");
    expect(json).not.toContain("está sem");
    expect(stored).not.toHaveProperty("text");
    expect(stored).not.toHaveProperty("players");
    expect(stored.playersCount).toBe(2);
    expect(stored.playerChecks).toEqual([
      { status: "unverifiable", questionId: "attack_weakened_home" },
      { status: "confirmed", questionId: "attack_weakened_home" },
    ]);
    expect(claimDescription(stored, TEAMS)).toBe(
      "desfalque no ataque do Flamengo (2 jogadores citados)",
    );
  });
});

describe("applyUserClaims", () => {
  it("não verificável com JEV: max(JEV, 0,7) e origem 'unverified'", () => {
    const jev = answers({ attack_weakened_away: 0.9 });
    const r = apply([ATTACK_HOME], jev);
    expect(r.evidence).toEqual({ attack_weakened_home: 0.7 });
    expect(r.answers?.attack_weakened_home.value).toBe(0.7);
    expect(r.answers?.attack_weakened_away.value).toBe(0.9);
    expect(r.origins).toEqual({ attack_weakened_home: "unverified" });
    expect(r.moved).toBe(true);
    expect(JSON.stringify(r.stored)).not.toContain("Pedro");
    expect(r.stored.versions).toEqual({
      userEvidence: "user_evidence_v1",
      extract: "user_palpite_extract_v1",
    });
  });

  it("JEV já mais forte: nada se move, sem origem", () => {
    const jev = answers({ attack_weakened_home: 0.8 });
    const r = apply([ATTACK_HOME], jev);
    expect(r.answers?.attack_weakened_home.value).toBe(0.8);
    expect(r.moved).toBe(false);
    expect(r.origins).toEqual({});
  });

  it("confirmada pelos nossos dados com JEV presente não sobe; sem JEV vale 0,85", () => {
    const facts = factsFromAnalysisData({
      absences: {
        home: enrichAbsences([
          { player: { name: "Pedro Guilherme" }, type: "injury", status: "injured" },
        ]).map((a) => ({ ...a, position: "forward" as const, isRegularStarter: true })),
        away: [],
      },
      homeForm: [],
      awayForm: [],
      standings: undefined,
    });
    const withJev = apply([ATTACK_HOME], answers(), facts);
    expect(withJev.evidence).toEqual({});
    expect(withJev.moved).toBe(false);
    // Sem evidência: a MESMA referência do JEV (números idênticos ao run sem contexto).
    const jev = answers();
    expect(apply([ATTACK_HOME], jev, facts).answers).toBe(jev);

    const noJev = apply([ATTACK_HOME], null, facts);
    expect(noJev.evidence).toEqual({ attack_weakened_home: 0.85 });
    expect(noJev.answers?.attack_weakened_home.value).toBe(0.85);
    expect(noJev.origins).toEqual({ attack_weakened_home: "confirmed" });
  });

  it("desfalque confirmado na lista como meio-campista: o papel é do usuário, origem 'unverified'", () => {
    const facts = factsFromAnalysisData({
      absences: {
        home: enrichAbsences([
          { player: { name: "Pedro Guilherme" }, type: "injury", status: "injured" },
        ]).map((a) => ({ ...a, position: "midfielder" as const, isRegularStarter: true })),
        away: [],
      },
      homeForm: [],
      awayForm: [],
      standings: undefined,
    });
    for (const jev of [answers(), null]) {
      const r = apply([ATTACK_HOME], jev, facts);
      expect(r.stored.claims[0].status).toBe("confirmed");
      expect(r.stored.claims[0].signals).toEqual([
        { questionId: "attack_weakened_home", strength: "unverified" },
      ]);
      expect(r.evidence).toEqual({ attack_weakened_home: 0.7 });
      expect(r.origins).toEqual({ attack_weakened_home: "unverified" });
    }
  });

  it("'outra informação' não gera sinal", () => {
    const r = apply([{ team: "both", topic: "other", text: "clássico" }], answers());
    expect(r.evidence).toEqual({});
    expect(r.moved).toBe(false);
    expect(r.stored.claims).toHaveLength(1);
    expect(r.notes).toEqual([]);
  });

  it("other com subtipo (#569): vira nota do código, guarda o enum, sem efeito no número", () => {
    const r = apply(
      [
        { team: "home", topic: "other", otherKind: "coach_change", text: "o técnico caiu ontem" },
        { team: "both", topic: "other", otherKind: "derby", text: "é clássico" },
        { team: "away", topic: "other", otherKind: "derby", text: "clássico de novo" },
        { team: "both", topic: "other", text: "o juiz é ruim" },
      ],
      null,
    );
    expect(r.evidence).toEqual({});
    expect(r.moved).toBe(false);
    expect(r.notes).toEqual(["troca de técnico no Flamengo", "clássico entre os dois times"]);
    expect(r.stored.claims.map((c) => c.otherKind)).toEqual([
      "coach_change",
      "derby",
      "derby",
      undefined,
    ]);
    expect(JSON.stringify(r.stored)).not.toContain("técnico caiu");
    // O schema de leitura não descarta o subtipo.
    const parsed = PredictionUserContextSchema.parse(JSON.parse(JSON.stringify(r.stored)));
    expect(parsed.claims[0].otherKind).toBe("coach_change");
  });
});

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
      adjusted: { home: 1.5, away: 1.1 },
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

const CONTEXT: PredictionUserContext = apply([ATTACK_HOME], answers()).stored;

function row(
  marketKey: string | null,
  minutesAgo: number,
  j: PredictionJudgments | null,
  isLive = false,
) {
  return {
    marketKey,
    prediction: {
      createdAt: new Date(KICKOFF.getTime() - 86_400_000 - minutesAgo * 60_000),
      judgments: j,
      isLive,
    },
  };
}

describe("pickUserContext", () => {
  it("a row code_jev mais nova entre as últimas por mercado, com o contexto DELA", () => {
    const history = [
      row("btts", 1, judgments({ userContext: CONTEXT })),
      row("match_result", 2, judgments({ userContext: CONTEXT })),
      row("correct_score", 0.5, null),
    ].sort((a, b) => b.prediction.createdAt.getTime() - a.prediction.createdAt.getTime());
    const picked = pickUserContext(history);
    expect(picked?.context.claims).toHaveLength(1);
    expect(picked?.createdAt).toEqual(history[1].prediction.createdAt);
  });

  it("reanálise parcial sem contexto esconde o contexto do run anterior (não filtra antes)", () => {
    const history = [
      // Reanálise de uma seção (over/under) sem contexto, depois do run com contexto.
      row("over_under", 1, judgments()),
      row("match_result", 10, judgments({ userContext: CONTEXT })),
      row("over_under", 10, judgments({ userContext: CONTEXT })),
    ];
    expect(pickUserContext(history)).toBeNull();
  });

  it("leitura ao vivo mais nova não esconde o contexto da análise de pré-jogo (#594)", () => {
    const history = [
      row("match_result", -60, null, true),
      row("over_under", -60, null, true),
      row("match_result", 10, judgments({ userContext: CONTEXT })),
    ];
    const picked = pickUserContext(history);
    expect(picked?.context.claims).toHaveLength(1);
    expect(picked?.createdAt).toEqual(history[2].prediction.createdAt);
  });

  it("row antiga superada no mesmo mercado não conta", () => {
    const history = [
      row("match_result", 1, judgments()),
      row("match_result", 10, judgments({ userContext: CONTEXT })),
    ];
    expect(pickUserContext(history)).toBeNull();
  });

  it("jsonb malformado → null", () => {
    const bad = judgments({
      userContext: { claims: "x" } as unknown as PredictionUserContext,
    });
    expect(pickUserContext([row("match_result", 1, bad)])).toBeNull();
  });
});

describe("analysisContextNotice", () => {
  const ok = (n: number, warnings: string[] = []) => ({
    ok: true as const,
    claims: Array.from({ length: n }),
    warnings,
  });

  it("extração falhou ou estourou o teto", () => {
    expect(analysisContextNotice(null, [])).toBe(CONTEXT_FAILED_NOTICE);
    expect(analysisContextNotice({ ok: false }, [])).toBe(CONTEXT_FAILED_NOTICE);
  });

  it("zero afirmações", () => {
    expect(analysisContextNotice(ok(0), [judgments()])).toBe(CONTEXT_EMPTY_NOTICE);
  });

  it("nenhuma row code_jev levou o contexto", () => {
    expect(analysisContextNotice(ok(1), [judgments(), null])).toBe(CONTEXT_NOT_USED_NOTICE);
  });

  it("alguma afirmação moveu um fator → entrou; com avisos da extração no fim", () => {
    expect(
      analysisContextNotice(ok(1, ["Considerei só as 8 primeiras afirmações do seu contexto."]), [
        judgments({ userContext: CONTEXT }),
      ]),
    ).toBe(
      `${CONTEXT_APPLIED_NOTICE} Considerei só as 8 primeiras afirmações do seu contexto.`,
    );
  });

  it("sem fator movido, mas com nota (#569)", () => {
    const noted = apply(
      [{ team: "home", topic: "other", otherKind: "coach_change", text: "técnico novo" }],
      answers(),
    ).stored;
    expect(analysisContextNotice(ok(1), [judgments({ userContext: noted })])).toBe(
      CONTEXT_NOTED_NOTICE,
    );
    // Fator movido continua mandando o aviso de "entrou".
    const both = apply(
      [ATTACK_HOME, { team: "home", topic: "other", otherKind: "crowd", text: "casa cheia" }],
      answers(),
    ).stored;
    expect(analysisContextNotice(ok(2), [judgments({ userContext: both })])).toBe(
      CONTEXT_APPLIED_NOTICE,
    );
  });

  it("conferido mas sem efeito (JEV já considerava)", () => {
    expect(
      analysisContextNotice(ok(1), [
        judgments({ answers: answers({ attack_weakened_home: 0.9 }), userContext: CONTEXT }),
      ]),
    ).toBe(CONTEXT_NO_EFFECT_NOTICE);
  });
});

describe("claimDescription", () => {
  it.each([
    [{ team: "away", topic: "absence", role: "defense" }, "desfalque na defesa do Palmeiras"],
    [{ team: "home", topic: "absence", role: "goalkeeper", playersCount: 1 }, "desfalque no gol do Flamengo"],
    [{ team: "home", topic: "full_squad", scope: "suspensions" }, "Flamengo sem desfalques (suspensões)"],
    [{ team: "both", topic: "form", direction: "good" }, "os dois times em boa fase"],
    [{ team: "away", topic: "form", direction: "bad" }, "Palmeiras em má fase"],
    [{ team: "home", topic: "rotation" }, "Flamengo deve poupar titulares"],
    [{ team: "away", topic: "stakes", direction: "good" }, "jogo decisivo pro Palmeiras"],
    [{ team: "home", topic: "stakes", direction: "bad" }, "jogo sem peso pro Flamengo"],
    [{ team: "both", topic: "other" }, "outra informação sobre o jogo"],
    [{ team: "home", topic: "other", otherKind: "coach_change" }, "troca de técnico no Flamengo"],
    [{ team: "both", topic: "other", otherKind: "coach_change" }, "troca de técnico nos dois times"],
    [{ team: "away", topic: "other", otherKind: "derby" }, "clássico entre os dois times"],
    [{ team: "home", topic: "other", otherKind: "weather" }, "clima ou gramado que pode pesar no jogo"],
    [{ team: "away", topic: "other", otherKind: "travel_fatigue" }, "desgaste de viagem do Palmeiras"],
    [{ team: "home", topic: "other", otherKind: "crowd" }, "torcida como fator pro Flamengo"],
    [{ team: "away", topic: "other", otherKind: "motivation" }, "motivação do Palmeiras como fator"],
  ] as const)("%o → %s", (c, expected) => {
    expect(claimDescription(c, TEAMS)).toBe(expected);
  });
});

describe("subtipos de other (#569)", () => {
  it("rótulo do tópico: o subtipo, senão o tópico", () => {
    expect(claimTopicLabel({ topic: "other", otherKind: "weather" })).toBe("clima");
    expect(claimTopicLabel({ topic: "other" })).toBe("outro");
    expect(claimTopicLabel({ topic: "form" })).toBe("momento");
  });

  it("hasContextNote e contextNotes só contam other com subtipo", () => {
    const claims = [
      { team: "home", topic: "other" },
      { team: "home", topic: "form" },
    ] as const;
    expect(hasContextNote(claims)).toBe(false);
    expect(contextNotes(claims, TEAMS)).toEqual([]);
    const withKind = [...claims, { team: "away", topic: "other", otherKind: "crowd" }] as const;
    expect(hasContextNote(withKind)).toBe(true);
    expect(contextNotes(withKind, TEAMS)).toEqual(["torcida como fator pro Palmeiras"]);
  });

  it("ClaimSchema: otherKind só em other e só do enum", () => {
    const base = { team: "home", text: "x" } as const;
    expect(ClaimSchema.safeParse({ ...base, topic: "other", otherKind: "derby" }).success).toBe(true);
    expect(ClaimSchema.safeParse({ ...base, topic: "other" }).success).toBe(true);
    expect(
      ClaimSchema.safeParse({ ...base, topic: "rotation", otherKind: "derby" }).success,
    ).toBe(false);
    expect(ClaimSchema.safeParse({ ...base, topic: "other", otherKind: "referee" }).success).toBe(
      false,
    );
  });

  it("StoredClaimsSchema lê row antiga (sem subtipo) e nova", () => {
    const row = {
      team: "home",
      topic: "other",
      text: "x",
      index: 0,
      status: "unverifiable",
      evidence: "e",
      sides: [{ side: "home", status: "unverifiable" }],
      playerChecks: [],
      signals: [],
    };
    expect(StoredClaimsSchema.parse([row])[0].otherKind).toBeUndefined();
    expect(StoredClaimsSchema.parse([{ ...row, otherKind: "motivation" }])[0].otherKind).toBe(
      "motivation",
    );
  });
});
