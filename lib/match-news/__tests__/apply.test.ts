import { describe, expect, it } from "vitest";

import {
  JUDGMENT_WEIGHTS,
  TEAM_MULTIPLIER_MAX,
  TEAM_MULTIPLIER_MIN,
  applyJudgments,
  factorMultiplier,
} from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAbsenceInput, LineupSummary } from "@/lib/ai/judgments/state";
import type {
  JudgmentAnswers,
  JudgmentFactor,
  JudgmentQuestionId,
} from "@/lib/ai/judgments/types";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import { factsFromAnalysisData } from "@/lib/user-palpite/analysis-context";
import type { PalpiteFacts } from "@/lib/user-palpite/check-claims";
import { combineAnswers, evidenceFromClaims } from "@/lib/user-palpite/evidence";
import type { CheckedClaim, ClaimSignal, UserEvidence } from "@/lib/user-palpite/types";

import { NEWS_EVIDENCE_VERSION, applyNewsClaims } from "../apply";
import { modelAnswersOf } from "../model-answers";
import { MatchModelNewsSchema, type MatchNewsBatchItem, type NewsClaim } from "../types";

// Conferência e evidência das notícias (#672, PLAN-672 §5/§6 + ajustes 3 e 4).

const TEAMS = { home: "SE Palmeiras", away: "CR Flamengo" };
const KICKOFF = new Date("2026-11-21T21:30:00Z");
const NOW = new Date("2026-11-21T13:00:00Z");
const HOUR = 3_600_000;

function answers(over: Partial<Record<JudgmentQuestionId, number>> = {}): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: over[id] ?? 0.3, confidence: null }]),
  ) as JudgmentAnswers;
}

// O JEV do exemplo do §6.
const JEV = answers({
  high_stakes_home: 0.9,
  high_stakes_away: 0.9,
  rotation_risk_home: 0.4,
  defense_weakened_away: 0.2,
});

const item = (n: number, hoursAgo = n): MatchNewsBatchItem => ({
  ref: `N${n}`,
  newsId: `id-${n}`,
  url: `https://ge.globo.com/futebol/noticia/${n}.ghtml`,
  title: `Matéria ${n}`,
  publishedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
});

function fixture(team: string, daysBefore: number): NormalizedFixture {
  const k = new Date(KICKOFF.getTime() - daysBefore * 86_400_000);
  return {
    id: `${team}:${daysBefore}`,
    league: "brasileirao_a",
    kickoffAt: k.toISOString(),
    kickoffTimestampMs: k.getTime(),
    homeTeam: team,
    awayTeam: "X",
    status: "finished",
    score: { home: 1, away: 0 },
  };
}

function standings(): NormalizedStanding {
  const teams = [TEAMS.home, TEAMS.away, ...Array.from({ length: 18 }, (_, i) => `Time ${i}`)];
  return {
    league: "brasileirao_a",
    season: 2026,
    tables: [
      {
        teams: teams.map((team, i) => ({
          position: i + 1,
          team,
          played: 35,
          won: 20,
          draw: 5,
          lost: 10,
          goalsFor: 50,
          goalsAgainst: 30,
          points: i < 2 ? 75 - i : 50 - i,
        })),
      },
    ],
  };
}

function absence(name: string, position: JudgmentAbsenceInput["position"]): JudgmentAbsenceInput {
  return {
    injury: { player: { name }, type: "suspension", status: "suspended" },
    position,
    isRegularStarter: true,
  };
}

function facts(over: {
  absences?: { home: JudgmentAbsenceInput[]; away: JudgmentAbsenceInput[] } | null;
  homeRestDays?: number;
} = {}): PalpiteFacts {
  return factsFromAnalysisData({
    absences: over.absences === undefined ? { home: [], away: [] } : over.absences,
    homeForm: [fixture(TEAMS.home, over.homeRestDays ?? 4)],
    awayForm: [fixture(TEAMS.away, 7)],
    standings: standings(),
  });
}

const leo: NewsClaim = {
  team: "away",
  topic: "absence",
  text: "o zagueiro citado está suspenso",
  players: ["Léo Pereira"],
  role: "defense",
  sources: ["N1"],
};
const poupar: NewsClaim = {
  team: "home",
  topic: "rotation",
  text: "vai poupar titulares",
  sources: ["N2"],
};
const empate: NewsClaim = {
  team: "away",
  topic: "other",
  otherKind: "motivation",
  text: "o empate basta",
  sources: ["N3"],
};
const final: NewsClaim = {
  team: "both",
  topic: "stakes",
  direction: "good",
  text: "final do campeonato",
  sources: ["N4"],
};

const batch = (claims: NewsClaim[], items = [item(1), item(2), item(3), item(4)]) => ({
  id: "batch-1",
  promptVersion: "match_news_extract_v1",
  items,
  claims,
});

const NOT_ANNOUNCED = { home: { status: "not_announced" }, away: { status: "not_announced" } } as {
  home: LineupSummary;
  away: LineupSummary;
};

const run = (over: Partial<Parameters<typeof applyNewsClaims>[0]> = {}) =>
  applyNewsClaims({
    batch: batch([leo, poupar, empate, final]),
    facts: facts(),
    lineup: NOT_ANNOUNCED,
    teams: TEAMS,
    league: "brasileirao_a",
    kickoffAt: KICKOFF,
    now: NOW,
    jev: JEV,
    ...over,
  });

describe("exemplo do §6 (Palmeiras × Flamengo, λ base 1,40 × 1,00)", () => {
  const base = { lambdaHome: 1.4, lambdaAway: 1.0 };

  it("só JEV: 1,4336 × 1,024", () => {
    const j = applyJudgments(base, JEV);
    expect(j.lambdaHome).toBeCloseTo(1.4336, 10);
    expect(j.lambdaAway).toBeCloseTo(1.024, 10);
  });

  it("com o lote: 1,43865 (desfalque não conferido × rodízio não conferido); K = 2", () => {
    const news = run();
    expect(news.evidence).toEqual({ defense_weakened_away: 0.7, rotation_risk_home: 0.7 });
    const j = applyJudgments(base, news.answers);
    expect(j.lambdaHome).toBeCloseTo(1.4 * 1.024 * 1.024 * 0.98, 10);
    expect(j.lambdaHome).toBeCloseTo(1.43865, 5);
    expect(j.lambdaAway).toBeCloseTo(1.024, 10);
    expect(news.itemsRead).toBe(4);
    expect(news.factorItems).toBe(2);
    expect(news.movedUrls).toEqual([item(1).url, item(2).url]);
    expect([...news.moved].sort()).toEqual(["defense_weakened_away", "rotation_risk_home"]);
    expect(news.origins).toEqual({
      defense_weakened_away: "unverified",
      rotation_risk_home: "unverified",
    });
    expect(news.notes).toEqual([
      "motivação do CR Flamengo como fator, segundo o ge (não conferido)",
    ]);
  });

  it("final dos dois, confirmada pela tabela com JEV presente: já considerada, não move", () => {
    const news = run({ batch: batch([final]) });
    expect(news.stored.claims[0].status).toBe("confirmed");
    expect(news.evidence).toEqual({});
    expect(news.answers).toBe(JEV);
    expect(news.factorItems).toBe(0);
  });

  it("JEV falhou e o desfalque está na nossa lista como defensor titular: confirmada, ×1,042", () => {
    const news = run({
      batch: batch([leo]),
      jev: null,
      facts: facts({ absences: { home: [], away: [absence("Léo Pereira", "defender")] } }),
    });
    expect(news.evidence).toEqual({ defense_weakened_away: 0.85 });
    expect(news.origins).toEqual({ defense_weakened_away: "confirmed" });
    const j = applyJudgments(base, news.answers);
    expect(j.lambdaHome / base.lambdaHome).toBeCloseTo(1.042, 10);
  });
});

describe("uma linha da tabela do §5 por caso", () => {
  it("absence com nome fora da nossa lista → não conferível, sinal pelo papel", () => {
    const c = run({ batch: batch([leo]) }).stored.claims[0];
    expect(c.status).toBe("unverifiable");
    expect(c.signals).toEqual([{ questionId: "defense_weakened_away", strength: "unverified" }]);
    // Sem texto livre nem nome no que a base guarda.
    expect(JSON.stringify(c)).not.toMatch(/Léo|Pereira|suspenso/);
    expect(c.playersCount).toBe(1);
    expect(c.sources).toEqual(["N1"]);
  });

  it("absence na nossa lista como dúvida → não conferível; reserva → confirmada sem sinal", () => {
    const doubtful: JudgmentAbsenceInput = {
      injury: { player: { name: "Léo Pereira" }, type: "injury", status: "doubtful" },
      position: "defender",
      isRegularStarter: true,
    };
    const d = run({ batch: batch([leo]), facts: facts({ absences: { home: [], away: [doubtful] } }) });
    expect(d.stored.claims[0].status).toBe("unverifiable");
    expect(d.evidence).toEqual({ defense_weakened_away: 0.7 });
    const reserve = { ...absence("Léo Pereira", "defender"), isRegularStarter: false };
    const r = run({ batch: batch([leo]), facts: facts({ absences: { home: [], away: [reserve] } }) });
    expect(r.stored.claims[0].status).toBe("confirmed");
    expect(r.evidence).toEqual({});
  });

  it("absence sem nome → não conferível pelo papel", () => {
    const { players: _p, ...noName } = leo;
    const news = run({ batch: batch([{ ...noName, role: "attack" }]) });
    expect(news.evidence).toEqual({ attack_weakened_away: 0.7 });
  });

  it("full_squad: alguém fora → contradita; lista vazia → não conferível; nunca sinal", () => {
    const squad: NewsClaim = { team: "away", topic: "full_squad", scope: "all", text: "força máxima", sources: ["N1"] };
    const out = run({
      batch: batch([squad]),
      facts: facts({ absences: { home: [], away: [absence("Pedro", "forward")] } }),
    });
    expect(out.stored.claims[0].status).toBe("contradicted");
    expect(out.evidence).toEqual({});
    const empty = run({ batch: batch([squad]) });
    expect(empty.stored.claims[0].status).toBe("unverifiable");
    expect(empty.evidence).toEqual({});
  });

  it("rotation: jogou há <72h → confirmada (com JEV, sem efeito; sem JEV, 0,85)", () => {
    const withJev = run({ batch: batch([poupar]), facts: facts({ homeRestDays: 2 }) });
    expect(withJev.stored.claims[0].status).toBe("confirmed");
    expect(withJev.evidence).toEqual({});
    const noJev = run({ batch: batch([poupar]), facts: facts({ homeRestDays: 2 }), jev: null });
    expect(noJev.evidence).toEqual({ rotation_risk_home: 0.85 });
  });

  it("stakes good: meio de tabela → contradita sem sinal; sem tabela (Libertadores) → não conferível", () => {
    const mid: NewsClaim = { ...final, team: "home", sources: ["N4"] };
    const table = standings();
    table.tables[0].teams = table.tables[0].teams.map((t) =>
      t.team === TEAMS.home ? { ...t, position: 10, points: 45 } : t,
    );
    const contradicted = run({
      batch: batch([mid]),
      facts: factsFromAnalysisData({
        absences: { home: [], away: [] },
        homeForm: [],
        awayForm: [],
        standings: table,
      }),
    });
    expect(contradicted.stored.claims[0].status).not.toBe("confirmed");
    expect(contradicted.evidence).toEqual({});
    const libertadores = run({ batch: batch([mid]), league: "copa_libertadores" });
    expect(libertadores.stored.claims[0].status).toBe("unverifiable");
    expect(libertadores.evidence).toEqual({ high_stakes_home: 0.7 });
  });

  it("other → nota, sem sinal", () => {
    const coach: NewsClaim = { team: "home", topic: "other", otherKind: "coach_change", text: "técnico novo", sources: ["N3"] };
    const news = run({ batch: batch([coach, empate]) });
    expect(news.evidence).toEqual({});
    expect(news.notes).toEqual([
      "troca de técnico no SE Palmeiras, segundo o ge (não conferido)",
      "motivação do CR Flamengo como fator, segundo o ge (não conferido)",
    ]);
  });
});

describe("escalação publicada (ajuste 3)", () => {
  it("XI de um lado publicado zera os sinais de desfalque e rodízio da notícia daquele lado", () => {
    const lineup = {
      home: { status: "announced", changes: "0-2", leftOut: [] },
      away: { status: "announced", changes: null, leftOut: [] },
    } as { home: LineupSummary; away: LineupSummary };
    const news = run({ lineup });
    expect(news.evidence).toEqual({});
    expect(news.stored.claims.find((c) => c.topic === "absence")?.signals).toEqual([]);
    expect(news.stored.claims.find((c) => c.topic === "rotation")?.signals).toEqual([]);
    expect(news.factorItems).toBe(0);
  });

  it("só o lado publicado perde os sinais", () => {
    const lineup = {
      home: { status: "not_announced" },
      away: { status: "announced", changes: "3-4", leftOut: [] },
    } as { home: LineupSummary; away: LineupSummary };
    const news = run({ lineup });
    expect(news.evidence).toEqual({ rotation_risk_home: 0.7 });
  });

  it("stakes não é escalação: segue (sem JEV, 0,85 confirmada)", () => {
    const lineup = {
      home: { status: "announced", changes: "0-2", leftOut: [] },
      away: { status: "announced", changes: "0-2", leftOut: [] },
    } as { home: LineupSummary; away: LineupSummary };
    const news = run({ batch: batch([final]), lineup, jev: null });
    expect(news.evidence).toEqual({ high_stakes_home: 0.85, high_stakes_away: 0.85 });
  });
});

describe("janela das fontes e K", () => {
  it("fonte fora da janela (> 72h antes, ou depois de agora) tira a afirmação", () => {
    const news = run({
      batch: batch([leo, poupar], [item(1, 80), item(2, -1), item(3), item(4)]),
    });
    expect(news.stored.claims).toEqual([]);
    expect(news.evidence).toEqual({});
    expect(news.itemsRead).toBe(2);
  });

  it("afirmação com uma fonte dentro e outra fora fica, só com a de dentro", () => {
    const both: NewsClaim = { ...leo, sources: ["N1", "N2"] };
    const news = run({ batch: batch([both], [item(1, 80), item(2), item(3), item(4)]) });
    expect(news.stored.claims[0].sources).toEqual(["N2"]);
    expect(news.stored.sources.map((s) => s.ref)).toEqual(["N2"]);
  });

  it("depois do apito a âncora é o apito", () => {
    const after = new Date(KICKOFF.getTime() + 2 * HOUR);
    const news = run({
      now: after,
      batch: batch([leo], [{ ...item(1), publishedAt: new Date(KICKOFF.getTime() + HOUR).toISOString() }]),
    });
    expect(news.stored.claims).toEqual([]);
  });

  it("K conta matérias distintas (duas afirmações da mesma notícia = 1)", () => {
    const both: NewsClaim = { ...leo, sources: ["N1"] };
    const rot: NewsClaim = { ...poupar, sources: ["N1"] };
    expect(run({ batch: batch([both, rot]) }).factorItems).toBe(1);
  });
});

describe("contrato de disponibilidade", () => {
  it("desfalques indisponíveis vs lista vazia (fetchMatchJudgmentData engoliu a falha): mesma evidência", () => {
    const squad: NewsClaim = { team: "home", topic: "full_squad", scope: "all", text: "força máxima", sources: ["N2"] };
    const claims = [leo, squad, poupar];
    const unavailable = run({ batch: batch(claims), facts: facts({ absences: null }) });
    const empty = run({ batch: batch(claims), facts: facts({ absences: { home: [], away: [] } }) });
    expect(empty.evidence).toEqual(unavailable.evidence);
    expect(empty.stored.claims.map((c) => [c.status, c.signals])).toEqual(
      unavailable.stored.claims.map((c) => [c.status, c.signals]),
    );
  });
});

describe("o que a base guarda", () => {
  it("passa no schema, com versões e só as fontes citadas", () => {
    const news = run();
    expect(MatchModelNewsSchema.safeParse(news.stored).success).toBe(true);
    expect(news.stored.versions).toEqual({
      extract: "match_news_extract_v1",
      newsEvidence: NEWS_EVIDENCE_VERSION,
    });
    expect(news.stored.batchId).toBe("batch-1");
    expect(JSON.stringify(news.stored)).not.toMatch(/Léo|poupar titulares|empate basta/);
  });

  it("modelAnswersOf = JEV ∨ notícia; sem notícia, o JEV; nada, null", () => {
    const news = run();
    expect(modelAnswersOf({ answers: JEV, news: news.stored })).toEqual(news.answers);
    expect(modelAnswersOf({ answers: JEV })).toBe(JEV);
    expect(modelAnswersOf({ answers: null, news: null })).toBeNull();
    expect(modelAnswersOf(null)).toBeNull();
    const onlyNews = modelAnswersOf({ answers: null, news: { evidence: { attack_weakened_home: 0.7 } } });
    expect(onlyNews?.attack_weakened_home.value).toBe(0.7);
    expect(onlyNews?.high_stakes_home.value).toBe(0.5);
  });
});

// ─── Teste de propriedade (espelho do ADR 0055 §5) ──────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const factorOf = (id: JudgmentQuestionId) =>
  id.replace(/_(home|away)$/, "") as JudgmentFactor;

function randomEvidence(r: () => number, jevApplied: boolean): UserEvidence {
  const signals: ClaimSignal[] = JUDGMENT_QUESTION_IDS.flatMap((questionId) =>
    r() < 0.5 ? [{ questionId, strength: r() < 0.5 ? ("confirmed" as const) : ("unverified" as const) }] : [],
  );
  return evidenceFromClaims([{ signals } as unknown as CheckedClaim], { jevApplied });
}

describe("efeito limitado no λ (propriedade)", () => {
  it("JEV, notícia e usuário aleatórios: resposta ≤ max(JEV, 0,85), fator ≤ o desse máximo e clamp", () => {
    const r = rng(672);
    for (let i = 0; i < 500; i++) {
      const jev = r() < 0.3 ? null : answers(
        Object.fromEntries(JUDGMENT_QUESTION_IDS.map((id) => [id, r()])) as Record<JudgmentQuestionId, number>,
      );
      const news = randomEvidence(r, jev !== null);
      const user = randomEvidence(r, jev !== null);
      const base = combineAnswers(jev, news);
      const all = combineAnswers(base, user);
      const lambdas = { lambdaHome: 0.5 + r() * 2, lambdaAway: 0.5 + r() * 2 };
      const applied = applyJudgments(lambdas, all);
      for (const id of JUDGMENT_QUESTION_IDS) {
        const ceiling = Math.max(jev?.[id].value ?? 0, 0.85);
        const v = all?.[id].value ?? 0.5;
        expect(v).toBeLessThanOrEqual(ceiling + 1e-12);
        const f = factorOf(id);
        const m = factorMultiplier(f, v);
        const mMax = factorMultiplier(f, ceiling);
        // Sinal positivo: m ≤ mMax; negativo: m ≥ mMax (o efeito nunca passa o do teto).
        expect(Math.abs(m - 1)).toBeLessThanOrEqual(Math.abs(mMax - 1) + 1e-12);
        expect(Math.abs(m - 1)).toBeLessThanOrEqual(JUDGMENT_WEIGHTS[f] + 1e-12);
      }
      if (applied.multipliers) {
        for (const side of ["home", "away"] as const) {
          expect(applied.multipliers[side].applied).toBeGreaterThanOrEqual(TEAM_MULTIPLIER_MIN);
          expect(applied.multipliers[side].applied).toBeLessThanOrEqual(TEAM_MULTIPLIER_MAX);
        }
      }
    }
  });

  it("máximo, nunca soma: JEV 0,8 + notícia 0,7 = 0,8; notícia 0,7 + usuário 0,7 = 0,7", () => {
    const jev = answers({ attack_weakened_home: 0.8 });
    expect(combineAnswers(jev, { attack_weakened_home: 0.7 })?.attack_weakened_home.value).toBe(0.8);
    const withNews = combineAnswers(null, { attack_weakened_home: 0.7 });
    expect(combineAnswers(withNews, { attack_weakened_home: 0.7 })?.attack_weakened_home.value).toBe(0.7);
  });

  it("pior caso sem JEV (feed hostil, só confirmadas impossíveis): λ do próprio time ≥ −7,5%", () => {
    // Desfalque no ataque confirmado (0,85) + rodízio confirmado (0,85), sem JEV.
    const worst = combineAnswers(null, { attack_weakened_home: 0.85, rotation_risk_home: 0.85 });
    const j = applyJudgments({ lambdaHome: 1, lambdaAway: 1 }, worst);
    expect(j.lambdaHome).toBeCloseTo(0.958 * 0.965, 10);
    expect(1 - j.lambdaHome).toBeLessThan(0.076);
  });
});
