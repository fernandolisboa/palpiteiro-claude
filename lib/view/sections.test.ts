import { describe, expect, it } from "vitest";

import type {
  NormalizedH2H,
  NormalizedStanding,
  NormalizedStandingTeam,
} from "@/lib/providers/sports-data/types";

import { getMarketPresentation } from "./markets/presentation";
import { toH2HView, toStandingsView } from "./sections";

// Confronto mínimo (toH2HView só lê score + kickoffTimestampMs + times).
function fx(homeGoals: number, awayGoals: number, ms: number): NormalizedH2H {
  return {
    id: `f-${ms}`,
    league: "brasileirao_a",
    kickoffAt: new Date(ms).toISOString(),
    kickoffTimestampMs: ms,
    homeTeam: "Casa FC",
    awayTeam: "Visita EC",
    status: "finished",
    score: { home: homeGoals, away: awayGoals },
  };
}

describe("toH2HView", () => {
  // 3 jogos: 2 over (3,4 gols), 1 under (1 gol) — ordenados por kickoff desc.
  const h2h: NormalizedH2H[] = [
    fx(2, 1, 3_000), // 3 gols → over
    fx(3, 1, 2_000), // 4 gols → over
    fx(1, 0, 1_000), // 1 gol  → under
  ];

  it("default = corte over/under (paridade): tags over/under + summary 'over X% · média Y gols'", () => {
    const view = toH2HView(h2h);
    expect(view.rows.map((r) => r.tag)).toEqual(["over", "over", "under"]);
    // over 2/3 = 67%; média (3+4+1)/3 = 2.7.
    expect(view.summary).toBe("over 67% · média 2.7 gols");
  });

  it("classify do registry over_under bate com o default", () => {
    const classify = getMarketPresentation("over_under").classifyH2H;
    const viaRegistry = toH2HView(h2h, 5, (h, a) => classify!(h, a, 2.5));
    expect(viaRegistry).toEqual(toH2HView(h2h));
  });

  it("mercado não baseado em gols (classify null): tags neutras + summary só com a média", () => {
    const view = toH2HView(h2h, 5, null);
    expect(view.rows.map((r) => r.tag)).toEqual(["", "", ""]);
    expect(view.summary).toBe("média 2.7 gols");
  });

  it("sem histórico: summary degrada", () => {
    expect(toH2HView([]).summary).toBe("sem histórico recente");
    expect(toH2HView([], 5, null).summary).toBe("sem histórico recente");
  });
});

// Time mínimo de classificação (toStandingsView lê pos/team/points/gf/ga + foco).
function team(position: number, name: string): NormalizedStandingTeam {
  return {
    position,
    team: name,
    played: 1,
    won: 0,
    draw: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };
}

// Tabela com N times em ordem de posição (índice 0 = pos 1 = líder), como os
// providers entregam. Nomes determinísticos "T<pos>" pra asserts legíveis.
function standing(size: number): NormalizedStanding {
  return {
    league: "brasileirao_a",
    season: 2026,
    tables: [
      {
        teams: Array.from({ length: size }, (_, i) => team(i + 1, `T${i + 1}`)),
      },
    ],
  };
}

describe("toStandingsView (janela)", () => {
  // Regressão #337: grupo de 4 com jogo entre pos 3 e 4 — o líder (pos 1) sumia
  // porque a janela ancorava acima do foco sem clampar contra o fim do array.
  it("grupo de 4, jogo entre pos 3 e 4: mostra os 4 times com o líder visível", () => {
    const view = toStandingsView({
      standing: standing(4),
      homeTeam: "T3",
      awayTeam: "T4",
    });
    expect(view.rows.map((r) => r.pos)).toEqual([1, 2, 3, 4]);
    expect(view.rows.find((r) => r.pos === 1)?.team).toBe("T1");
    expect(view.rows.filter((r) => r.focus).map((r) => r.pos)).toEqual([3, 4]);
  });

  it("liga de 20, jogo no fundo (pos 18 e 19): clampa nas últimas 5 com ambos os focos", () => {
    const view = toStandingsView({
      standing: standing(20),
      homeTeam: "T18",
      awayTeam: "T19",
    });
    expect(view.rows.map((r) => r.pos)).toEqual([16, 17, 18, 19, 20]);
    expect(view.rows.filter((r) => r.focus).map((r) => r.pos)).toEqual([18, 19]);
  });

  it("liga de 20, jogo no topo (pos 1 e 2): janela inalterada (1–5)", () => {
    const view = toStandingsView({
      standing: standing(20),
      homeTeam: "T1",
      awayTeam: "T2",
    });
    expect(view.rows.map((r) => r.pos)).toEqual([1, 2, 3, 4, 5]);
  });

  it("liga de 20, jogo no meio (pos 7 e 8): janela uma acima do foco (6–10)", () => {
    const view = toStandingsView({
      standing: standing(20),
      homeTeam: "T7",
      awayTeam: "T8",
    });
    expect(view.rows.map((r) => r.pos)).toEqual([6, 7, 8, 9, 10]);
  });

  it("window >= tamanho da tabela: mostra todas as linhas", () => {
    const view = toStandingsView({
      standing: standing(3),
      homeTeam: "T2",
      awayTeam: "T3",
      windowSize: 5,
    });
    expect(view.rows.map((r) => r.pos)).toEqual([1, 2, 3]);
  });

  it("sem time de foco na tabela: mostra o topo (primeiras window linhas)", () => {
    const view = toStandingsView({
      standing: standing(20),
      homeTeam: "Fantasma A",
      awayTeam: "Fantasma B",
    });
    expect(view.rows.map((r) => r.pos)).toEqual([1, 2, 3, 4, 5]);
    expect(view.rows.every((r) => r.focus === false)).toBe(true);
  });

  it("um só time de foco na tabela: janela ancora nele, só uma linha com foco", () => {
    const view = toStandingsView({
      standing: standing(20),
      homeTeam: "T8",
      awayTeam: "Fantasma",
    });
    expect(view.rows.map((r) => r.pos)).toEqual([7, 8, 9, 10, 11]);
    expect(view.rows.filter((r) => r.focus).map((r) => r.pos)).toEqual([8]);
  });

  it("grupos (ex.: fase de grupos): janela usa a tabela do grupo dos times de foco", () => {
    // Dois grupos de 4; o jogo é entre dois times do grupo B (pos 3 e 4 do B).
    // O clamp tem que rodar contra a tabela SELECIONADA, não tables[0].
    const grouped: NormalizedStanding = {
      league: "brasileirao_a",
      season: 2026,
      tables: [
        { group: "A", teams: ["A1", "A2", "A3", "A4"].map((n, i) => team(i + 1, n)) },
        { group: "B", teams: ["B1", "B2", "B3", "B4"].map((n, i) => team(i + 1, n)) },
      ],
    };
    const view = toStandingsView({
      standing: grouped,
      homeTeam: "B3",
      awayTeam: "B4",
    });
    expect(view.rows.map((r) => r.team)).toEqual(["B1", "B2", "B3", "B4"]);
    expect(view.rows.filter((r) => r.focus).map((r) => r.team)).toEqual([
      "B3",
      "B4",
    ]);
  });

  it("standing ausente: rows vazio (EmptyState)", () => {
    expect(toStandingsView({ standing: undefined, homeTeam: "T1", awayTeam: "T2" }).rows).toEqual([]);
  });

  it("Copa: exibe os nomes das seleções em PT-BR; foco casa pelo canonical (#340)", () => {
    // Grupo real de 4; o jogo é Ecuador x Curaçao (o cenário do bug #337).
    const wc: NormalizedStanding = {
      league: "world_cup",
      season: 2026,
      tables: [
        {
          teams: [
            team(1, "Germany"),
            team(2, "Ivory Coast"),
            team(3, "Ecuador"),
            team(4, "Curaçao"),
          ],
        },
      ],
    };
    const view = toStandingsView({
      standing: wc,
      homeTeam: "Ecuador",
      awayTeam: "Curaçao",
    });
    // Nome exibido = PT-BR (líder visível, vindo do fix do #337).
    expect(view.rows.map((r) => r.team)).toEqual([
      "Alemanha",
      "Costa do Marfim",
      "Equador",
      "Curaçao",
    ]);
    // Foco continua casando pelo canonical EN, não pelo label traduzido.
    expect(view.rows.filter((r) => r.focus).map((r) => r.pos)).toEqual([3, 4]);
  });
});
