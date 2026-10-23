import { describe, expect, it } from "vitest";

import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";
import type { ModelScoreline } from "@/lib/quant/match-model";

import {
  analysesDetail,
  jevDetail,
  modelDetail,
  newsDetail,
  sportsDataDetail,
  synthesisDetail,
  userContextDetail,
} from "../details";

const teams = { home: "Vitória", away: "Athletico-PR" };

function fixture(
  home: string,
  away: string,
  score: [number, number] | null,
  ts: number,
): NormalizedFixture {
  return {
    id: `${home}-${away}-${ts}`,
    league: "brasileirao_a",
    kickoffAt: new Date(ts).toISOString(),
    kickoffTimestampMs: ts,
    homeTeam: home,
    awayTeam: away,
    status: score ? "finished" : "scheduled",
    score: { home: score?.[0] ?? null, away: score?.[1] ?? null },
  } as NormalizedFixture;
}

const homeForm = [
  fixture("Vitória", "Bahia", [2, 0], 3),
  fixture("Santos", "Vitória", [1, 1], 2),
  fixture("Vitória", "Grêmio", [0, 1], 1),
  fixture("Vitória", "Ceará", null, 4),
];

function answers(overrides: Partial<Record<keyof JudgmentAnswers, number>> = {}) {
  const ids = [
    "attack_weakened_home",
    "attack_weakened_away",
    "defense_weakened_home",
    "defense_weakened_away",
    "rotation_risk_home",
    "rotation_risk_away",
    "high_stakes_home",
    "high_stakes_away",
  ] as const;
  return Object.fromEntries(
    ids.map((id) => [id, { value: overrides[id] ?? 0.2, confidence: null }]),
  ) as JudgmentAnswers;
}

function scoreline(source: ModelScoreline["source"]): ModelScoreline {
  const cells = [
    [0.1, 0.05, 0.02],
    [0.2, 0.12, 0.03],
    [0.08, 0.06, 0.01],
  ];
  return {
    source,
    degraded: false,
    lambdaHome: 1.42,
    lambdaAway: 1.05,
    matrix: { cells, maxGoals: 2 },
  };
}

describe("detalhes das etapas (Ver raciocínio, ADR 0065)", () => {
  it("dados dos times: forma (mais novo primeiro), confronto, tabela, desfalques, escalação", () => {
    const lines = sportsDataDetail({
      teams,
      homeForm,
      awayForm: [],
      h2h: [
        fixture("Vitória", "Athletico-PR", [1, 0], 1),
        fixture("Athletico-PR", "Vitória", [2, 2], 2),
        fixture("Athletico-PR", "Vitória", [3, 1], 3),
      ],
      standings: {
        league: "brasileirao_a",
        season: 2026,
        tables: [
          {
            teams: [
              { position: 14, team: "Vitória" },
              { position: 8, team: "Athletico-PR" },
            ] as never,
          },
        ],
      },
      absences: { home: 3, away: 1 },
      lineups: null,
    });
    expect(lines).toEqual([
      "Forma recente do Vitória (mais novo primeiro): V E D",
      "Últimos 3 confrontos: 1 vitória do Vitória, 1 empate, 1 vitória do Athletico-PR",
      "Tabela: Vitória em 14º, Athletico-PR em 8º",
      "Desfalques: 3 no Vitória, 1 no Athletico-PR",
      "Escalações ainda não divulgadas",
    ]);
  });

  it("desfalques indisponíveis ou zerados", () => {
    const base = { teams, homeForm: [], awayForm: [], h2h: [], lineups: undefined };
    expect(sportsDataDetail({ ...base, absences: null })).toContain(
      "Lista de desfalques indisponível agora",
    );
    expect(sportsDataDetail({ ...base, absences: { home: 0, away: 0 } })).toContain(
      "Nenhum desfalque informado para os dois times",
    );
  });

  it("modelo: gols esperados em pt-BR, placar mais provável e a fonte", () => {
    expect(modelDetail(scoreline("dixon_coles"), teams)).toEqual([
      "Gols esperados: Vitória 1,4, Athletico-PR 1,1",
      "Placar mais provável pelo modelo: 1–0",
      "Força de ataque e defesa dos times recalculada todo dia com os jogos da liga",
    ]);
    expect(modelDetail(scoreline("heuristic"), teams)[2]).toMatch(/tabela/);
  });

  it("JEV: só os fatores que mexem nas chances; nenhum → frase neutra; sem respostas → nada", () => {
    expect(jevDetail(answers(), teams)).toEqual([
      "Nenhum fator de contexto (desfalques, rodízio, peso do jogo) mexeu nas chances",
    ]);
    const lines = jevDetail(answers({ rotation_risk_away: 0.9 }), teams);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Athletico-PR.*poupado/);
    expect(jevDetail(null, teams)).toEqual([]);
  });

  it("contexto extra, notícias, análises e síntese", () => {
    expect(userContextDetail({ moved: true, notes: ["nota"] })).toEqual([
      "O que você contou mexeu nas chances do modelo",
      "nota",
    ]);
    expect(newsDetail(0)).toEqual([]);
    expect(newsDetail(1)).toEqual(["1 notícia usada no palpite"]);
    expect(
      analysesDetail([
        { marketLabel: "Dupla chance", recommendedLabel: "Vitória ou empate", isPass: false },
        { marketLabel: "Ambas marcam", recommendedLabel: null, isPass: true },
      ]),
    ).toEqual(["Dupla chance: Vitória ou empate", "Ambas marcam: sem escolha neste mercado"]);
    expect(synthesisDetail({ confidence: "media" })).toEqual(["Confiança do palpite: média"]);
  });

  it("nenhuma linha tem linguagem de valor, % ou casa de aposta", () => {
    const lines = [
      ...sportsDataDetail({
        teams,
        homeForm,
        awayForm: homeForm,
        h2h: [],
        absences: { home: 1, away: 1 },
        lineups: undefined,
      }),
      ...modelDetail(scoreline("dixon_coles"), teams),
      ...modelDetail(scoreline("heuristic"), teams),
      ...jevDetail(
        answers({
          attack_weakened_home: 0.9,
          defense_weakened_away: 0.7,
          rotation_risk_home: 0.8,
          high_stakes_away: 0.9,
        }),
        teams,
      ),
      ...jevDetail(answers(), teams),
      ...userContextDetail({ moved: false, notes: [] }),
      ...newsDetail(3),
      ...synthesisDetail({ confidence: "alta" }),
    ];
    for (const line of lines) {
      expect(containsValueLanguage(line), line).toBe(false);
      expect(line, line).not.toMatch(/%/);
      expect(line.toLowerCase(), line).not.toMatch(
        /bet365|betano|pinnacle|betfair|sportingbet|casa de aposta|bookmaker/,
      );
    }
  });
});
