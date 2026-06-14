import { describe, expect, it } from "vitest";

import {
  buildPredictionInput,
  buildUserMessage,
  doubleChanceCartridge,
} from "@/lib/ai/markets/double_chance";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";

const STANDINGS: NormalizedStanding = {
  league: "world_cup",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: "Germany",
          played: 3,
          won: 3,
          draw: 0,
          lost: 0,
          goalsFor: 9,
          goalsAgainst: 1,
          points: 9,
        },
        {
          position: 2,
          team: "Curaçao",
          played: 3,
          won: 1,
          draw: 1,
          lost: 1,
          goalsFor: 4,
          goalsAgainst: 5,
          points: 4,
        },
      ],
    },
  ],
};

describe("double_chance buildUserMessage — dupla chance framing snapshot", () => {
  it("renders the 3 duplas odds + implied (que somam ~200%) na moldura leiga", () => {
    const input = buildPredictionInput({
      match: {
        externalId: "ext-1",
        league: "world_cup",
        homeTeam: "Germany",
        awayTeam: "Curaçao",
        kickoffAt: new Date("2026-06-14T17:00:00.000Z"),
        venue: "Allianz Arena",
      },
      standings: STANDINGS,
      home: { form: [], injuries: [], absencesAvailable: true },
      away: { form: [], injuries: [], absencesAvailable: true },
      lineups: undefined,
      h2h: [],
      odds: {
        bookmaker: "Pinnacle",
        captured_at: "2026-06-14T12:00:00.000Z",
        selections: [
          { key: "home_or_draw", odd: 1.05 },
          { key: "away_or_draw", odd: 6.5 },
          { key: "home_or_away", odd: 1.08 },
        ],
      },
      implied: {
        pct: { home_or_draw: 94.5, away_or_draw: 18.3, home_or_away: 87.2 },
      },
    });
    const message = buildUserMessage(input, { daysToKickoff: 0 });
    expect(message).toMatchInlineSnapshot(`
      "# Jogo
      - Competição: world_cup
      - Mandante: Germany
      - Visitante: Curaçao
      - Kickoff (UTC): 2026-06-14T17:00:00.000Z
      - Local: Allianz Arena

      # Mandante — Germany
      ## Classificação
      - Posição: 1, 9 pts em 3 jogos
      - Gols: 9 pró / 1 contra (saldo 8)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Visitante — Curaçao
      ## Classificação
      - Posição: 2, 4 pts em 3 jogos
      - Gols: 4 pró / 5 contra (saldo -1)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Confrontos diretos (H2H)
      - (sem histórico fornecido)

      # Odds e probabilidades implícitas
      - Bookmaker: Pinnacle (capturado em 2026-06-14T12:00:00.000Z)
      - Dupla chance: Casa ou empate (1X) / Empate ou fora (X2) / Casa ou fora (12)
      - As duplas se sobrepõem: as implícitas normalizadas somam ~200% (cada dupla cobre dois resultados), não 100%.
      - Casa ou empate (1X): odd 1.05 → implícita normalizada 94.50%
      - Empate ou fora (X2): odd 6.50 → implícita normalizada 18.30%
      - Casa ou fora (12): odd 1.08 → implícita normalizada 87.20%

      # Contexto temporal
      - Dias até o jogo: 0 (≤1 = dados mais confiáveis; ≥5 = lineup ainda indefinido, lesões podem mudar)

      # Sua tarefa
      Estime prob_home_or_draw/prob_away_or_draw/prob_home_or_away (somam ~200%, pois as duplas se sobrepõem) e decida: "home_or_draw", "away_or_draw", "home_or_away" ou "pass". Aplique a regra de edge >= 5% por dupla. Chame a ferramenta submit_prediction com os campos do schema."
    `);
  });
});

describe("double_chance MIN_EDGE_PP ↔ SYSTEM_PROMPT sync", () => {
  it("the UI threshold constant matches the prompt's edge rule", () => {
    expect(doubleChanceCartridge.systemPrompt).toContain(
      `${MIN_EDGE_PP} pontos percentuais`,
    );
  });
});
