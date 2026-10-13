import { describe, expect, it } from "vitest";

import {
  pointInTimeStanding,
  seasonGamesPlayed,
} from "@/lib/backtest/features";
import {
  parseFootballDataCsv,
  type HistoricalMatch,
} from "@/lib/backtest/matches";
import {
  brier1x2,
  closingMarketStrategy,
  devig1x2,
  logLoss1x2,
  pairedLogLossDiff,
  runBacktest,
  summarize,
  type Strategy,
} from "@/lib/backtest/runner";
import { toCanonicalTeam } from "@/lib/backtest/team-names";

const HEADER =
  "Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA,MaxCH,MaxCD,MaxCA,AvgCH,AvgCD,AvgCA,BFECH,BFECD,BFECA,B365CH,B365CD,B365CA";

describe("parseFootballDataCsv", () => {
  it("parseia placar, data UTC, odds de fechamento e ordena por data", () => {
    const csv = [
      "﻿" + HEADER,
      "Brazil,Serie A,2024,14/04/2024,21:00,Palmeiras,Vitoria,2,1,H,1.40,4.80,8.50,,,,1.38,4.60,8.00,,,,,,",
      "Brazil,Serie A,2024,13/04/2024,16:00,Flamengo RJ,Sao Paulo,0,0,D,,,,,,,2.00,3.30,3.90,,,,,,",
    ].join("\n");
    const ms = parseFootballDataCsv(csv);
    expect(ms.map((m) => m.home)).toEqual(["Flamengo RJ", "Palmeiras"]);
    expect(ms[0].date.toISOString()).toBe("2024-04-13T00:00:00.000Z");
    expect(ms[0].closingPinnacle).toBeNull();
    expect(ms[0].closingAvg).toEqual({ home: 2, draw: 3.3, away: 3.9 });
    expect(ms[1]).toMatchObject({ homeGoals: 2, awayGoals: 1, season: 2024 });
    expect(ms[1].closingPinnacle).toEqual({ home: 1.4, draw: 4.8, away: 8.5 });
  });

  it("descarta linha sem placar (jogo não disputado)", () => {
    const csv = [
      HEADER,
      "Brazil,Serie A,2026,20/12/2026,16:00,Santos,Remo,,,,,,,,,,,,,,,,,,",
    ].join("\n");
    expect(parseFootballDataCsv(csv)).toEqual([]);
  });

  it("lê as odds de fechamento de over/under 2.5 quando o snapshot tem", () => {
    const csv = [
      "Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA,AvgCH,AvgCD,AvgCA,PC>2.5,PC<2.5,AvgC>2.5,AvgC<2.5",
      "England,Premier League,2024,16/08/2024,20:00,Man United,Fulham,1,0,H,1.60,4.20,5.50,1.58,4.10,5.30,1.80,2.10,1.78,2.05",
      "England,Premier League,2025,15/08/2025,20:00,Liverpool,Bournemouth,4,2,H,,,,1.30,6.00,9.00,,,1.50,2.60",
    ].join("\n");
    const [a, b] = parseFootballDataCsv(csv);
    expect(a.closingOu25Pinnacle).toEqual({ over: 1.8, under: 2.1 });
    expect(a.closingOu25Avg).toEqual({ over: 1.78, under: 2.05 });
    expect(b.closingOu25Pinnacle).toBeNull();
    expect(b.closingOu25Avg).toEqual({ over: 1.5, under: 2.6 });
  });

  it("lê as odds de pré-fechamento quando o snapshot tem", () => {
    const csv = [
      "Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA,AvgCH,AvgCD,AvgCA,PC>2.5,PC<2.5,AvgC>2.5,AvgC<2.5,PSH,PSD,PSA,AvgH,AvgD,AvgA,P>2.5,P<2.5,Avg>2.5,Avg<2.5",
      "England,Premier League,2024,16/08/2024,20:00,Man United,Fulham,1,0,H,1.60,4.20,5.50,1.58,4.10,5.30,1.80,2.10,1.78,2.05,1.65,4.00,5.20,1.62,3.90,5.00,1.85,2.05,1.82,2.00",
    ].join("\n");
    const [m] = parseFootballDataCsv(csv);
    expect(m.preClosingPinnacle).toEqual({ home: 1.65, draw: 4, away: 5.2 });
    expect(m.preClosingAvg).toEqual({ home: 1.62, draw: 3.9, away: 5 });
    expect(m.preClosingOu25Pinnacle).toEqual({ over: 1.85, under: 2.05 });
    expect(m.preClosingOu25Avg).toEqual({ over: 1.82, under: 2 });
    expect(m.closingPinnacle).toEqual({ home: 1.6, draw: 4.2, away: 5.5 });
  });

  it("snapshot sem colunas de over/under (Brasileirão) não inventa odds", () => {
    const csv = [
      HEADER,
      "Brazil,Serie A,2024,14/04/2024,21:00,Palmeiras,Vitoria,2,1,H,1.40,4.80,8.50,,,,1.38,4.60,8.00,,,,,,",
    ].join("\n");
    const [m] = parseFootballDataCsv(csv);
    expect(m.closingOu25Pinnacle).toBeNull();
    expect(m.closingOu25Avg).toBeNull();
    expect(m.preClosingPinnacle).toBeNull();
    expect(m.preClosingOu25Avg).toBeNull();
  });
});

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const match = (
  date: string,
  home: string,
  away: string,
  hg: number,
  ag: number,
  season = 2024,
): HistoricalMatch => ({
  season,
  date: d(date),
  home,
  away,
  homeGoals: hg,
  awayGoals: ag,
  closingPinnacle: null,
  closingAvg: { home: 2.5, draw: 3.2, away: 3.0 },
});

describe("features point-in-time", () => {
  const history = [
    match("2024-04-01", "A", "B", 2, 0),
    match("2024-04-08", "B", "A", 1, 1),
    match("2024-04-15", "A", "C", 3, 1), // mesmo dia do corte: NÃO entra
    match("2023-11-01", "A", "B", 5, 0, 2023), // outra temporada: NÃO entra
  ];

  it("tabela usa só jogos da temporada ANTES da data, com splits por mando", () => {
    const st = pointInTimeStanding(history, 2024, d("2024-04-15"));
    const a = st.tables[0].teams.find((t) => t.team === "A")!;
    expect(a).toMatchObject({ played: 2, won: 1, draw: 1, points: 4 });
    expect(a.homeSplit).toMatchObject({
      played: 1,
      goalsFor: 2,
      goalsAgainst: 0,
    });
    expect(a.awaySplit).toMatchObject({
      played: 1,
      goalsFor: 1,
      goalsAgainst: 1,
    });
    expect(st.tables[0].teams.find((t) => t.team === "C")).toBeUndefined();
    expect(st.tables[0].teams[0].team).toBe("A"); // 4 pts > 1 pt
  });

  it("seasonGamesPlayed respeita o corte", () => {
    expect(seasonGamesPlayed(history, "A", 2024, d("2024-04-15"))).toBe(2);
    expect(seasonGamesPlayed(history, "A", 2024, d("2024-04-16"))).toBe(3);
  });
});

describe("runner", () => {
  it("métricas 1X2: log-loss e Brier de uma previsão conhecida", () => {
    const p = { home: 0.5, draw: 0.3, away: 0.2 };
    expect(logLoss1x2(p, "home")).toBeCloseTo(Math.log(2), 12);
    expect(brier1x2(p, "home")).toBeCloseTo(0.25 + 0.09 + 0.04, 12);
  });

  it("de-vig proporcional soma 1", () => {
    const p = devig1x2({ home: 2, draw: 3.4, away: 3.8 });
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 12);
    expect(p.home).toBeGreaterThan(p.away);
  });

  it("mercado de-vigia o over 2.5 (Pinnacle, senão média) e mantém o 1X2", () => {
    const base = match("2024-04-01", "A", "B", 2, 1);
    const withOu = closingMarketStrategy.predict(
      {
        ...base,
        closingOu25Pinnacle: null,
        closingOu25Avg: { over: 1.8, under: 2.1 },
      },
      [],
    );
    expect(withOu?.pOver25).toBeCloseTo(1 / 1.8 / (1 / 1.8 + 1 / 2.1), 12);
    expect(withOu?.p1x2).toEqual(devig1x2(base.closingAvg!));

    const pinnacleFirst = closingMarketStrategy.predict(
      {
        ...base,
        closingOu25Pinnacle: { over: 2, under: 2 },
        closingOu25Avg: { over: 1.8, under: 2.1 },
      },
      [],
    );
    expect(pinnacleFirst?.pOver25).toBeCloseTo(0.5, 12);

    // Sem odds de over/under: só 1X2, como no snapshot do Brasileirão.
    expect(closingMarketStrategy.predict(base, [])?.pOver25).toBeUndefined();
    expect(
      closingMarketStrategy.predict({ ...base, closingAvg: null }, []),
    ).toBeNull();
  });

  it("walk-forward: a estratégia nunca vê jogos do mesmo dia nem futuros", () => {
    const ms = [
      match("2024-04-01", "A", "B", 1, 0),
      match("2024-04-02", "B", "A", 0, 0),
      match("2024-04-02", "C", "D", 2, 2),
      match("2024-04-03", "A", "C", 1, 1),
    ];
    const seen: Record<string, number> = {};
    const spy: Strategy = {
      name: "spy",
      predict(m, history) {
        seen[`${m.home}-${m.away}`] = history.length;
        expect(history.every((h) => h.date < m.date)).toBe(true);
        return { pOver25: 0.5 };
      },
    };
    runBacktest(ms, [spy], { seasons: [2024], minSeasonGames: 0 });
    expect(seen).toEqual({ "A-B": 0, "B-A": 1, "C-D": 1, "A-C": 3 });
  });

  it("aquecimento exclui jogos em que algum time tem < N jogos na temporada", () => {
    const ms = [
      match("2024-04-01", "A", "B", 1, 0),
      match("2024-04-02", "A", "C", 1, 0),
    ];
    const ev = runBacktest(ms, [closingMarketStrategy], {
      seasons: [2024],
      minSeasonGames: 1,
    });
    expect(ev).toHaveLength(0); // no 2º jogo, C ainda tem 0
  });

  it("summarize e diferença pareada só contam jogos em que ambas opinam", () => {
    const ms = [
      match("2024-04-01", "A", "B", 3, 0),
      match("2024-04-02", "A", "B", 0, 0),
    ];
    const sure: Strategy = { name: "sure", predict: () => ({ pOver25: 0.9 }) };
    const coin: Strategy = {
      name: "coin",
      predict: (m) => (m.homeGoals === 3 ? { pOver25: 0.5 } : null),
    };
    const ev = runBacktest(ms, [sure, coin], {
      seasons: [2024],
      minSeasonGames: 0,
    });
    expect(summarize(ev, "sure", "over25").n).toBe(2);
    expect(summarize(ev, "coin", "over25").n).toBe(1);
    const diff = pairedLogLossDiff(ev, "sure", "coin", "over25");
    expect(diff.n).toBe(1);
    expect(diff.meanDiff).toBeCloseTo(-Math.log(0.9) + Math.log(0.5), 12);
  });
});

describe("toCanonicalTeam", () => {
  it("mapeia pro catálogo e passa adiante o que não está nele", () => {
    expect(toCanonicalTeam("Flamengo RJ")).toBe("CR Flamengo");
    expect(toCanonicalTeam("Sao Paulo")).toBe("São Paulo FC");
    expect(toCanonicalTeam("Cuiaba")).toBe("Cuiaba");
  });
});
