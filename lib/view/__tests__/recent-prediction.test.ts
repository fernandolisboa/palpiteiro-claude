import { describe, expect, it } from "vitest";

import {
  toRecentMatchViews,
  type RecentPredictionInput,
} from "@/lib/view/recent-prediction";

const NOW = new Date("2026-10-15T15:00:00Z");
const SP = "America/Sao_Paulo";

function pred(overrides: Partial<RecentPredictionInput> = {}): RecentPredictionInput {
  return {
    predictionId: "p1",
    matchId: "m1",
    league: "brasileirao_a",
    homeTeam: "CR Flamengo",
    awayTeam: "SE Palmeiras",
    kickoffAt: new Date("2026-10-17T22:00:00Z"), // sábado 19:00 em SP
    recommendation: "home",
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    marketParams: null,
    selectionLabel: "Casa",
    edgePct: "4.20",
    isLive: false,
    createdAt: new Date("2026-10-14T12:00:00Z"),
    ...overrides,
  };
}

describe("toRecentMatchViews — um cartão por jogo (ADR 0058)", () => {
  it("agrupa por jogo: siglas, liga, data do jogo no fuso e o rótulo da aposta", () => {
    const [v] = toRecentMatchViews([pred()], NOW, SP);
    expect(v).toMatchObject({
      matchId: "m1",
      league: "bsa",
      home: "FLA",
      away: "PAL",
      when: "sáb 17/10",
      moreBets: 0,
      passCount: 0,
    });
    // 1X2 mostra a sigla do time (não "Casa" nem "HOME"), com o mercado ao lado.
    expect(v.bets).toEqual([{ market: "Resultado (1X2)", rec: "FLA", edge: "+4,2 pontos" }]);
  });

  it("dedup por mercado: a reanálise vence a análise antiga do mesmo mercado", () => {
    const views = toRecentMatchViews(
      [
        pred({ predictionId: "new", recommendation: "away", selectionLabel: "Fora", edgePct: "3.00", createdAt: new Date("2026-10-14T18:00:00Z") }),
        pred({ predictionId: "old", recommendation: "home", createdAt: new Date("2026-10-14T12:00:00Z") }),
      ],
      NOW,
      SP,
    );
    expect(views).toHaveLength(1);
    expect(views[0].bets).toEqual([{ market: "Resultado (1X2)", rec: "PAL", edge: "+3,0 pontos" }]);
  });

  it("leitura ao vivo (pass) não apaga a aposta de pré-jogo do mesmo mercado (#594)", () => {
    const views = toRecentMatchViews(
      [
        pred({ predictionId: "live", recommendation: "pass", selectionLabel: null, edgePct: null, isLive: true, createdAt: new Date("2026-10-17T22:40:00Z") }),
        pred({ predictionId: "pre", createdAt: new Date("2026-10-14T12:00:00Z") }),
      ],
      NOW,
      SP,
    );
    expect(views).toHaveLength(1);
    expect(views[0].bets).toEqual([{ market: "Resultado (1X2)", rec: "FLA", edge: "+4,2 pontos" }]);
    expect(views[0].passCount).toBe(0);
  });

  it("jogo só com leituras ao vivo ainda tem cartão (todas sem aposta)", () => {
    const [v] = toRecentMatchViews(
      [
        pred({ recommendation: "pass", selectionLabel: null, edgePct: null, isLive: true }),
        pred({ marketKey: "btts", marketLabel: "Ambas marcam", recommendation: "pass", selectionLabel: null, edgePct: null, isLive: true }),
      ],
      NOW,
      SP,
    );
    expect(v.bets).toEqual([]);
    expect(v.passCount).toBe(2);
  });

  it("over/under multi-linha divide um slot (a chave não leva a linha)", () => {
    const [v] = toRecentMatchViews(
      [
        pred({ recommendation: "over", marketKey: "over_under", marketLabel: "Over/Under gols", marketParams: { line: 3.5 }, selectionLabel: "Over", createdAt: new Date("2026-10-14T18:00:00Z") }),
        pred({ recommendation: "under", marketKey: "over_under", marketLabel: "Over/Under gols", marketParams: { line: 2.5 }, selectionLabel: "Under" }),
      ],
      NOW,
      SP,
    );
    expect(v.bets.map((b) => [b.market, b.rec])).toEqual([["Total de gols", "Mais de 3,5"]]);
  });

  it("apostas antes, até duas visíveis por vantagem, +N e a contagem de sem aposta", () => {
    const [v] = toRecentMatchViews(
      [
        pred({ marketKey: "match_result", edgePct: "2.00" }),
        pred({ marketKey: "btts", marketLabel: "Ambas marcam", recommendation: "no", selectionLabel: "Não", edgePct: "5.60" }),
        pred({ marketKey: "over_under", marketLabel: "Over/Under gols", recommendation: "over", marketParams: { line: 2.5 }, selectionLabel: "Over", edgePct: "4.00" }),
        pred({ marketKey: "double_chance", marketLabel: "Dupla chance", recommendation: "pass", selectionLabel: null, edgePct: null }),
        pred({ marketKey: "anytime_scorer", marketLabel: "Artilheiro", recommendation: "pass", selectionLabel: null, edgePct: null }),
      ],
      NOW,
      SP,
    );
    expect(v.bets.map((b) => [b.market, b.rec, b.edge])).toEqual([
      ["Ambas marcam", "Não", "+5,6 pontos"],
      ["Total de gols", "Mais de 2,5", "+4,0 pontos"],
    ]);
    expect(v.moreBets).toBe(1);
    expect(v.passCount).toBe(2);
    // "PASS" nunca vira aposta visível.
    expect(v.bets.some((b) => b.rec === "Sem aposta")).toBe(false);
  });

  it("jogo só com mercados sem aposta: nenhuma aposta, todos contados", () => {
    const [v] = toRecentMatchViews(
      [
        pred({ recommendation: "pass", selectionLabel: null, edgePct: null }),
        pred({ marketKey: "btts", marketLabel: "Ambas marcam", recommendation: "pass", selectionLabel: null, edgePct: null }),
      ],
      NOW,
      SP,
    );
    expect(v.bets).toEqual([]);
    expect(v.passCount).toBe(2);
  });

  it("row legada sem marketId cai em over/under", () => {
    const [v] = toRecentMatchViews(
      [pred({ recommendation: "under", marketKey: null, marketLabel: null, selectionLabel: null })],
      NOW,
      SP,
    );
    expect(v.bets.map((b) => [b.market, b.rec])).toEqual([["Total de gols", "Menos de 2,5"]]);
  });

  it("artilheiro usa o nome do jogador", () => {
    const [v] = toRecentMatchViews(
      [pred({ recommendation: "scorer_pedro", marketKey: "anytime_scorer", marketLabel: "Artilheiro", selectionLabel: "Pedro" })],
      NOW,
      SP,
    );
    expect(v.bets.map((b) => [b.market, b.rec])).toEqual([["Artilheiro", "Pedro"]]);
  });

  it("ordena os jogos pela análise mais recente de cada um", () => {
    const views = toRecentMatchViews(
      [
        pred({ matchId: "a", createdAt: new Date("2026-10-14T10:00:00Z") }),
        pred({ matchId: "b", createdAt: new Date("2026-10-14T11:00:00Z") }),
        pred({ matchId: "a", marketKey: "btts", marketLabel: "Ambas marcam", recommendation: "yes", selectionLabel: "Sim", createdAt: new Date("2026-10-14T12:00:00Z") }),
      ],
      NOW,
      SP,
    );
    expect(views.map((v) => v.matchId)).toEqual(["a", "b"]);
  });

  it("empate na última análise: matchId desc, como a query", () => {
    const t = new Date("2026-10-14T10:00:00Z");
    const views = toRecentMatchViews(
      [pred({ matchId: "a", createdAt: t }), pred({ matchId: "c", createdAt: t }), pred({ matchId: "b", createdAt: t })],
      NOW,
      SP,
    );
    expect(views.map((v) => v.matchId)).toEqual(["c", "b", "a"]);
  });
});

describe("toRecentMatchViews — reconferência com a escalação (#619)", () => {
  it("é a análise atual do mercado no cartão, mas não muda a ordem dos jogos", () => {
    const views = toRecentMatchViews(
      [
        // Jogo m1: analisado às 12h, reconferido pelo cron às 18h.
        pred({
          predictionId: "r1",
          matchId: "m1",
          recommendation: "away",
          selectionLabel: "Fora",
          isRecheck: true,
          createdAt: new Date("2026-10-14T18:00:00Z"),
        }),
        pred({ predictionId: "p1", matchId: "m1" }),
        // Jogo m2: analisado às 14h, depois da análise do m1.
        pred({
          predictionId: "p2",
          matchId: "m2",
          createdAt: new Date("2026-10-14T14:00:00Z"),
        }),
      ],
      NOW,
      SP,
    );
    expect(views.map((v) => v.matchId)).toEqual(["m2", "m1"]);
    // A aposta do cartão é a da reconferência (fora: PAL), não a da análise de 12h.
    expect(views[1].bets.map((b) => b.rec)).toEqual(["PAL"]);
  });
});
