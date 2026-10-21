import { describe, expect, it } from "vitest";

import { latestAnalysisByMarket } from "@/lib/bets/analysis-probs";

type Row = Parameters<typeof latestAnalysisByMarket>[0][number];

function row(over: {
  id: string;
  createdAt: string;
  marketKey?: string | null;
  line?: number | null;
  recommendation?: string;
  selections: Row["selections"];
}): Row {
  return {
    marketKey: over.marketKey === undefined ? "match_result" : over.marketKey,
    prediction: {
      id: over.id,
      createdAt: new Date(over.createdAt),
      marketParams: over.line === undefined ? null : { line: over.line },
      ...(over.recommendation === undefined ? {} : { recommendation: over.recommendation }),
    },
    selections: over.selections,
  };
}

describe("latestAnalysisByMarket", () => {
  it("a análise mais nova de cada mercado vence (histórico desc por createdAt)", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "new-1x2",
        createdAt: "2026-10-12T12:00:00Z",
        selections: [
          { key: "home", modelProbPct: 52 },
          { key: "draw", modelProbPct: 26 },
          { key: "away", modelProbPct: 22 },
        ],
      }),
      row({
        id: "btts-1",
        createdAt: "2026-10-12T11:00:00Z",
        marketKey: "btts",
        selections: [
          { key: "yes", modelProbPct: 55 },
          { key: "no", modelProbPct: 45 },
        ],
      }),
      row({
        id: "old-1x2",
        createdAt: "2026-10-11T12:00:00Z",
        selections: [{ key: "home", modelProbPct: 40 }],
      }),
    ]);
    expect([...out.keys()].sort()).toEqual(["btts", "match_result"]);
    expect(out.get("match_result")).toEqual({
      predictionId: "new-1x2",
      createdAt: new Date("2026-10-12T12:00:00Z"),
      probs: { home: 52, draw: 26, away: 22 },
      recommendation: null,
    });
    expect(out.get("btts")?.predictionId).toBe("btts-1");
  });

  it("guarda a recomendação da análise (a marca IA da tabela, #576), pass inclusive", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "dc",
        createdAt: "2026-10-12T12:00:00Z",
        marketKey: "double_chance",
        recommendation: "home_or_draw",
        selections: [{ key: "home_or_draw", modelProbPct: 78 }],
      }),
      row({
        id: "btts",
        createdAt: "2026-10-12T11:00:00Z",
        marketKey: "btts",
        recommendation: "pass",
        selections: [{ key: "yes", modelProbPct: 50 }],
      }),
    ]);
    expect(out.get("double_chance")?.recommendation).toBe("home_or_draw");
    expect(out.get("btts")?.recommendation).toBe("pass");
  });

  it("over/under é chaveado por linha; marketKey null = over_under", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "ou25",
        createdAt: "2026-10-12T12:00:00Z",
        marketKey: null,
        line: 2.5,
        selections: [{ key: "over", modelProbPct: 58 }],
      }),
      row({
        id: "ou15",
        createdAt: "2026-10-12T11:00:00Z",
        marketKey: "over_under",
        line: 1.5,
        selections: [{ key: "over", modelProbPct: 77 }],
      }),
      row({
        id: "ou25-old",
        createdAt: "2026-10-10T11:00:00Z",
        marketKey: "over_under",
        line: 2.5,
        selections: [{ key: "over", modelProbPct: 40 }],
      }),
    ]);
    expect(out.get("over_under:2.5")?.predictionId).toBe("ou25");
    expect(out.get("over_under:1.5")?.probs).toEqual({ over: 77 });
  });

  it("linhas de O/U fora de 1.5/2.5/3.5 (ou sem linha) são ignoradas", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "ou45",
        createdAt: "2026-10-12T12:00:00Z",
        marketKey: "over_under",
        line: 4.5,
        selections: [{ key: "over", modelProbPct: 20 }],
      }),
      row({
        id: "ou05",
        createdAt: "2026-10-12T11:00:00Z",
        marketKey: "over_under",
        line: 0.5,
        selections: [{ key: "over", modelProbPct: 92 }],
      }),
      row({
        id: "ou-sem-linha",
        createdAt: "2026-10-12T10:00:00Z",
        marketKey: "over_under",
        selections: [{ key: "over", modelProbPct: 50 }],
      }),
      row({
        id: "ou35",
        createdAt: "2026-10-12T09:00:00Z",
        marketKey: "over_under",
        line: 3.5,
        selections: [{ key: "under", modelProbPct: 70 }],
      }),
    ]);
    expect([...out.keys()]).toEqual(["over_under:3.5"]);
  });

  it("mercados fora do cupom são ignorados", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "scorer",
        createdAt: "2026-10-12T12:00:00Z",
        marketKey: "anytime_goalscorer",
        selections: [{ key: "player-1", modelProbPct: 30 }],
      }),
    ]);
    expect(out.size).toBe(0);
  });

  it("seleções sem prob gravada (null) são puladas", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "dc",
        createdAt: "2026-10-12T12:00:00Z",
        marketKey: "double_chance",
        selections: [
          { key: "home_or_draw", modelProbPct: 70 },
          { key: "home_or_away", modelProbPct: null },
          { key: "away_or_draw", modelProbPct: 50 },
        ],
      }),
    ]);
    expect(out.get("double_chance")?.probs).toEqual({
      home_or_draw: 70,
      away_or_draw: 50,
    });
  });

  it("análise sem nenhuma prob conhecida não bloqueia uma mais velha do mesmo mercado", () => {
    const out = latestAnalysisByMarket([
      row({
        id: "unknown",
        createdAt: "2026-10-12T12:00:00Z",
        selections: [{ key: "home", modelProbPct: null }],
      }),
      row({
        id: "older",
        createdAt: "2026-10-11T12:00:00Z",
        selections: [{ key: "home", modelProbPct: 48 }],
      }),
    ]);
    expect(out.get("match_result")?.predictionId).toBe("older");
  });

  it("histórico vazio → mapa vazio", () => {
    expect(latestAnalysisByMarket([]).size).toBe(0);
  });
});
