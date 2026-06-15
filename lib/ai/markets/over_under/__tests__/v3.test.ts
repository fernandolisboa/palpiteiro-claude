import { describe, expect, it } from "vitest";

import { getCartridge } from "@/lib/ai/markets/registry";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";

import {
  buildPredictionInputV3,
  type BuildPredictionInputArgs,
} from "../build-input";
import { OverUnderOutputV3Schema } from "../schemas";
import { buildUserMessageV3 } from "../user-message-v3";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOME = "CR Flamengo";
const AWAY = "Fluminense FC";

const STANDINGS: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: HOME,
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
          team: AWAY,
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

// Escada de 3 linhas (1.5/2.5/3.5) no shape GENÉRICO `GenericOddsArgs.lineLadder`.
function args(
  overrides: Partial<BuildPredictionInputArgs> = {},
): BuildPredictionInputArgs {
  return {
    match: {
      externalId: "ext-1",
      league: "brasileirao_a",
      homeTeam: HOME,
      awayTeam: AWAY,
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
      selections: [],
      lineLadder: [
        {
          line: 1.5,
          bookmaker: "Pinnacle",
          captured_at: "2026-05-15T12:00:00.000Z",
          selections: [
            { key: "over", odd: 1.3 },
            { key: "under", odd: 3.4 },
          ],
          impliedPct: { over: 72.34, under: 27.66 },
        },
        {
          line: 2.5,
          bookmaker: "Pinnacle",
          captured_at: "2026-05-15T12:00:00.000Z",
          selections: [
            { key: "over", odd: 1.9 },
            { key: "under", odd: 1.95 },
          ],
          impliedPct: { over: 51.28, under: 48.72 },
        },
        {
          line: 3.5,
          bookmaker: "Pinnacle",
          captured_at: "2026-05-15T12:00:00.000Z",
          selections: [
            { key: "over", odd: 3.6 },
            { key: "under", odd: 1.28 },
          ],
          impliedPct: { over: 26.23, under: 73.77 },
        },
      ],
    },
    implied: { pct: {} },
    ...overrides,
  };
}

// ─── (a) build-input from a 3-line ladder ────────────────────────────────────

describe("buildPredictionInputV3 — escada multi-linha", () => {
  it("monta um input v3 com 3 `lines` a partir de uma escada de 3 linhas", () => {
    const input = buildPredictionInputV3(args());
    expect(input.lines).toHaveLength(3);
    expect(input.lines.map((l) => l.line)).toEqual([1.5, 2.5, 3.5]);
    const l25 = input.lines.find((l) => l.line === 2.5);
    expect(l25).toMatchObject({
      bookmaker: "Pinnacle",
      over_decimal: 1.9,
      under_decimal: 1.95,
      over_pct: 51.28,
      under_pct: 48.72,
    });
  });

  it("lança BuildInputError quando a escada está ausente", () => {
    const noLadder = args();
    delete noLadder.odds.lineLadder;
    expect(() => buildPredictionInputV3(noLadder)).toThrow(
      /lineLadder/,
    );
  });

  it("lança BuildInputError quando uma entrada não tem seleção 'over'/'under'", () => {
    const broken = args();
    broken.odds.lineLadder = [
      {
        line: 2.5,
        bookmaker: "Pinnacle",
        captured_at: "2026-05-15T12:00:00.000Z",
        selections: [{ key: "over", odd: 1.9 }],
        impliedPct: { over: 51.28, under: 48.72 },
      },
    ];
    expect(() => buildPredictionInputV3(broken)).toThrow(/selection/);
  });
});

// ─── (b) output schema ───────────────────────────────────────────────────────

function validOutput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recommendation: "over",
    line: 2.5,
    confidence_pct: 62,
    rationale: "Ataques eficientes e defesas frágeis sugerem jogo aberto.",
    key_factors: ["Média alta de gols", "Defesas vazadas"],
    minimum_odd: 1.8,
    ...over,
  };
}

describe("OverUnderOutputV3Schema — campo `line` obrigatório + refine", () => {
  it("aceita um output válido {line, over, minimum_odd}", () => {
    const parsed = OverUnderOutputV3Schema.safeParse(validOutput());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.line).toBe(2.5);
    }
  });

  it("rejeita line=2.75 (refine de meia-linha válida)", () => {
    expect(
      OverUnderOutputV3Schema.safeParse(validOutput({ line: 2.75 })).success,
    ).toBe(false);
  });

  it("rejeita line ausente (obrigatório mesmo em over)", () => {
    const noLine = validOutput();
    delete noLine.line;
    expect(OverUnderOutputV3Schema.safeParse(noLine).success).toBe(false);
  });

  it("rejeita minimum_odd presente quando 'pass'", () => {
    const parsed = OverUnderOutputV3Schema.safeParse(
      validOutput({ recommendation: "pass", confidence_pct: 50, minimum_odd: 2.0 }),
    );
    expect(parsed.success).toBe(false);
  });

  it("aceita 'pass' COM line e SEM minimum_odd", () => {
    const base = validOutput({ recommendation: "pass", confidence_pct: 48, line: 1.5 });
    delete base.minimum_odd;
    const parsed = OverUnderOutputV3Schema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.line).toBe(1.5);
    }
  });
});

// ─── (c) user-message snapshot ───────────────────────────────────────────────

describe("buildUserMessageV3 — mensagem markdown", () => {
  it("renderiza o contexto reusado do v2 + a escada de linhas", () => {
    const input = buildPredictionInputV3(args());
    const message = buildUserMessageV3(input, { daysToKickoff: 3 });
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

      # Odds e probabilidades implícitas por linha

      ## Linha 1.5 — Pinnacle (capturado em 2026-05-15T12:00:00.000Z)
      - Over 1.5: odd 1.30 → implícita normalizada 72.34%
      - Under 1.5: odd 3.40 → implícita normalizada 27.66%

      ## Linha 2.5 — Pinnacle (capturado em 2026-05-15T12:00:00.000Z)
      - Over 2.5: odd 1.90 → implícita normalizada 51.28%
      - Under 2.5: odd 1.95 → implícita normalizada 48.72%

      ## Linha 3.5 — Pinnacle (capturado em 2026-05-15T12:00:00.000Z)
      - Over 3.5: odd 3.60 → implícita normalizada 26.23%
      - Under 3.5: odd 1.28 → implícita normalizada 73.77%

      # Contexto temporal
      - Dias até o jogo: 3 (≤1 = dados mais confiáveis; ≥5 = lineup ainda indefinido, lesões podem mudar)

      # Sua tarefa
      Avalie TODAS as linhas acima e escolha UMA recomendação: a melhor combinação de linha (1.5, 2.5 ou 3.5) e lado ("over" ou "under"), ou "pass". Aplique a regra de edge >= 5% por lado/linha. Reporte sempre a linha avaliada como mais próxima de apostável no campo line (mesmo em "pass"). Chame a ferramenta submit_prediction com os campos do schema."
    `);
  });
});

// ─── (d) registry dispatch ───────────────────────────────────────────────────

describe("getCartridge — variante multi-linha por flag", () => {
  it("getCartridge('over_under', { extraLines: true }) devolve o v3", () => {
    const c = getCartridge("over_under", { extraLines: true });
    expect(c.version).toBe("over_under_v3.0");
  });

  it("getCartridge('over_under') (1 arg) continua devolvendo o v2", () => {
    const c = getCartridge("over_under");
    expect(c.version).toBe("over_under_v2.0");
  });

  it("flag ligada num mercado sem variante cai no base", () => {
    const c = getCartridge("match_result", { extraLines: true });
    expect(c.marketKey).toBe("match_result");
  });
});
