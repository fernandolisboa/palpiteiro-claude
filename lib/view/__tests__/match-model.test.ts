import { describe, expect, it } from "vitest";

import type { MatchModelSnapshot } from "@/lib/model-base/types";
import {
  toMatchModelLineView,
  toMatchModelReadingView,
} from "@/lib/view/match-model";

const NOW = new Date("2026-05-14T12:00:00Z");

function snapshot(over: Partial<MatchModelSnapshot> = {}): MatchModelSnapshot {
  return {
    id: "snap-1",
    matchId: "m-1",
    computedAt: NOW,
    checkedAt: new Date(NOW.getTime() - 3 * 3_600_000),
    modelVersion: "match_model_v1",
    fingerprint: "fp",
    lambdaSource: "dixon_coles",
    lambdaDegraded: false,
    lambdaFallbackReason: null,
    rho: -0.07,
    neutral: false,
    lambdaHomeBase: 1.6,
    lambdaAwayBase: 1.1,
    lambdaHome: 1.6,
    lambdaAway: 1.1,
    jevStatus: "not_attempted",
    judgments: null,
    probabilities: {
      match_result: { home: 52.3, draw: 25.2, away: 22.5 },
      double_chance: { home_or_draw: 77.5, away_or_draw: 47.7, home_or_away: 74.8 },
      btts: { yes: 51.2, no: 48.8 },
      over_under: {
        "1.5": { over: 74.1, under: 25.9 },
        "2.5": { over: 48.4, under: 51.6 },
        "3.5": { over: 26.2, under: 73.8 },
      },
    },
    topScorelines: [
      { home: 1, away: 1, pct: 12.4 },
      { home: 1, away: 0, pct: 11.9 },
    ],
    ...over,
  };
}

const withProbs = (
  mr: { home: number; draw: number; away: number },
  ou25: { over: number; under: number },
) => {
  const s = snapshot();
  return snapshot({
    probabilities: {
      ...s.probabilities,
      match_result: mr,
      over_under: { ...s.probabilities.over_under, "2.5": ou25 },
    },
  });
};

describe("toMatchModelLineView", () => {
  it("favorito = argmax do 1X2; gols = o lado mais provável do 2.5 (Under quando under > over)", () => {
    expect(toMatchModelLineView(snapshot())).toEqual({
      favorite: { label: "Casa", pct: "52%" },
      goals25: { label: "Under 2.5", pct: "52%" },
    });
    expect(
      toMatchModelLineView(
        withProbs({ home: 20, draw: 25, away: 55 }, { over: 61, under: 39 }),
      ),
    ).toEqual({
      favorite: { label: "Fora", pct: "55%" },
      goals25: { label: "Over 2.5", pct: "61%" },
    });
  });

  it("empates: 1X2 na ordem casa, empate, fora; Over no empate do 2.5", () => {
    expect(
      toMatchModelLineView(
        withProbs({ home: 30, draw: 40, away: 40 }, { over: 50, under: 50 }),
      ),
    ).toEqual({
      favorite: { label: "Empate", pct: "40%" },
      goals25: { label: "Over 2.5", pct: "50%" },
    });
    expect(
      toMatchModelLineView(
        withProbs({ home: 40, draw: 20, away: 40 }, { over: 50, under: 50 }),
      ).favorite.label,
    ).toBe("Casa");
  });
});

describe("toMatchModelReadingView", () => {
  it("probabilidade e odd justa (100/p) por seleção, em todos os mercados", () => {
    const view = toMatchModelReadingView(snapshot(), NOW);
    expect(view.markets.map((m) => m.label)).toEqual([
      "Resultado (1X2)",
      "Dupla chance",
      "Ambas marcam",
      "Over/Under gols · 1,5",
      "Over/Under gols · 2,5",
      "Over/Under gols · 3,5",
    ]);
    expect(view.markets[0].selections[0]).toEqual({
      label: "Casa",
      pct: "52,3%",
      fairOdd: (100 / 52.3).toFixed(2).replace(".", ","),
    });
    expect(view.markets[1].selections.map((s) => s.label)).toEqual([
      "Casa ou empate",
      "Empate ou fora",
      "Casa ou fora",
    ]);
    expect(view.markets[4].selections[1]).toEqual({
      label: "Under 2.5",
      pct: "51,6%",
      fairOdd: (100 / 51.6).toFixed(2).replace(".", ","),
    });
  });

  it("probabilidade 0 → odd justa '—'", () => {
    const s = snapshot();
    const view = toMatchModelReadingView(
      snapshot({
        probabilities: { ...s.probabilities, btts: { yes: 0, no: 100 } },
      }),
      NOW,
    );
    expect(view.markets[2].selections[0].fairOdd).toBe("—");
  });

  it("placares, 'calculado há' e nenhum campo de valor", () => {
    const view = toMatchModelReadingView(snapshot(), NOW);
    expect(view.topScorelines).toEqual([
      { score: "1–1", pct: "12,4%" },
      { score: "1–0", pct: "11,9%" },
    ]);
    expect(view.computedAgo).toBe("há 3h");
    expect(JSON.stringify(view)).not.toMatch(/edge|valor|"odd"/i);
  });

  it("checado há menos de 1 minuto → 'há menos de 1min', nunca 'há agora'", () => {
    const view = toMatchModelReadingView(
      snapshot({ checkedAt: new Date(NOW.getTime() - 20_000) }),
      NOW,
    );
    expect(view.computedAgo).toBe("há menos de 1min");
  });

  it("rótulo da fonte por motivo do fallback, dados limitados e JEV", () => {
    expect(toMatchModelReadingView(snapshot(), NOW).source).toBe("Dixon-Coles");
    const cases = {
      flag_off: "Dixon-Coles desligado",
      no_fit: "liga sem ajuste",
      stale_fit: "ajuste desatualizado",
      team_missing: "time sem histórico",
      few_matches: "pouco histórico",
      error: "erro nos ratings",
    } as const;
    for (const [reason, label] of Object.entries(cases)) {
      expect(
        toMatchModelReadingView(
          snapshot({
            lambdaSource: "heuristic",
            lambdaFallbackReason: reason as keyof typeof cases,
          }),
          NOW,
        ).source,
      ).toBe(`heurístico da tabela (${label})`);
    }
    expect(
      toMatchModelReadingView(
        snapshot({
          lambdaSource: "heuristic",
          lambdaFallbackReason: "no_fit",
          lambdaDegraded: true,
        }),
        NOW,
      ).source,
    ).toBe("heurístico da tabela (liga sem ajuste) · dados limitados");

    expect(toMatchModelReadingView(snapshot(), NOW).jev).toBeNull();
    expect(
      toMatchModelReadingView(snapshot({ jevStatus: "applied" }), NOW).jev,
    ).toBe("+ JEV");
    expect(
      toMatchModelReadingView(snapshot({ jevStatus: "failed" }), NOW).jev,
    ).toBe("JEV falhou");
  });
});

describe("rótulos com o nome dos times (#574)", () => {
  const TEAMS = { home: "Palmeiras", away: "Flamengo" };

  it("linha do /jogos: favorito com a sigla", () => {
    const line = toMatchModelLineView(snapshot(), { home: "PAL", away: "FLA" });
    expect(line.favorite).toEqual({ label: "PAL", pct: "52%" });
    // Sem teams: igual a antes.
    expect(toMatchModelLineView(snapshot()).favorite.label).toBe("Casa");
  });

  it("leitura do modelo: 1X2 e dupla chance com o nome; gols sem mudança", () => {
    const view = toMatchModelReadingView(snapshot(), NOW, TEAMS);
    expect(view.markets[0].selections.map((s) => s.label)).toEqual([
      "Palmeiras",
      "Empate",
      "Flamengo",
    ]);
    expect(view.markets[1].selections.map((s) => s.label)).toEqual([
      "Palmeiras ou empate",
      "Empate ou Flamengo",
      "Palmeiras ou Flamengo",
    ]);
    expect(view.markets[2].selections.map((s) => s.label)).toEqual(["Sim", "Não"]);
  });
});
