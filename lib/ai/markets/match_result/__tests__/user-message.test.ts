import { describe, expect, it } from "vitest";

import {
  buildPredictionInput,
  buildUserMessage,
  matchResultCartridge,
} from "@/lib/ai/markets/match_result";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";

const STANDINGS: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: "CR Flamengo",
          played: 10,
          won: 6,
          draw: 2,
          lost: 2,
          goalsFor: 18,
          goalsAgainst: 9,
          points: 20,
        },
        {
          position: 2,
          team: "Fluminense FC",
          played: 10,
          won: 5,
          draw: 3,
          lost: 2,
          goalsFor: 15,
          goalsAgainst: 10,
          points: 18,
        },
      ],
    },
  ],
};

describe("match_result buildUserMessage — 1X2 framing snapshot", () => {
  it("renders the 3-way odds + implied in the leigo 1X2 framing", () => {
    const input = buildPredictionInput({
      match: {
        externalId: "ext-1",
        league: "brasileirao_a",
        homeTeam: "CR Flamengo",
        awayTeam: "Fluminense FC",
        kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
        venue: "Maracanã",
      },
      standings: STANDINGS,
      home: { form: [], injuries: [], absencesAvailable: true },
      away: { form: [], injuries: [], absencesAvailable: true },
      lineups: undefined,
      h2h: [],
      odds: {
        bookmaker: "Pinnacle",
        captured_at: "2026-05-15T12:00:00.000Z",
        selections: [
          { key: "home", odd: 1.85 },
          { key: "draw", odd: 3.5 },
          { key: "away", odd: 4.2 },
        ],
      },
      implied: { pct: { home: 52.7, draw: 27.9, away: 19.4 } },
    });
    const message = buildUserMessage(input, { daysToKickoff: 3 });
    expect(message).toMatchInlineSnapshot(`
      "# Jogo
      - Competição: brasileirao_a
      - Mandante: CR Flamengo
      - Visitante: Fluminense FC
      - Kickoff (UTC): 2026-05-15T19:00:00.000Z
      - Local: Maracanã

      # Mandante — CR Flamengo
      ## Classificação
      - Posição: 1, 20 pts em 10 jogos
      - Gols: 18 pró / 9 contra (saldo 9)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Visitante — Fluminense FC
      ## Classificação
      - Posição: 2, 18 pts em 10 jogos
      - Gols: 15 pró / 10 contra (saldo 5)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Confrontos diretos (H2H)
      - (sem histórico fornecido)

      # Odds e probabilidades implícitas
      - Bookmaker: Pinnacle (capturado em 2026-05-15T12:00:00.000Z)
      - Resultado final: Casa / Empate / Fora (1X2)
      - Casa (CR Flamengo): odd 1.85 → implícita normalizada 52.70%
      - Empate: odd 3.50 → implícita normalizada 27.90%
      - Fora (Fluminense FC): odd 4.20 → implícita normalizada 19.40%

      # Contexto temporal
      - Dias até o jogo: 3 (≤1 = dados mais confiáveis; ≥5 = lineup ainda indefinido, lesões podem mudar)

      # Sua tarefa
      Estime prob_home/prob_draw/prob_away (sua distribuição completa) e decida: "home", "draw", "away" ou "pass". Aplique a regra de edge >= 5% por seleção. Chame a ferramenta submit_prediction com os campos do schema."
    `);
  });
});

describe("match_result MIN_EDGE_PP ↔ SYSTEM_PROMPT sync", () => {
  it("the UI threshold constant matches the prompt's edge rule", () => {
    // Mesmo pin do over_under: se um prompt futuro mudar o threshold de 5pp, este
    // teste quebra em vez de a UI mentir.
    expect(matchResultCartridge.systemPrompt).toContain(
      `${MIN_EDGE_PP} pontos percentuais`,
    );
  });
});
