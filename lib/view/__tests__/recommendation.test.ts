import { describe, expect, it } from "vitest";

import {
  PASS_LABEL,
  marketContextLabel,
  recommendationKind,
  recommendationLabel,
} from "@/lib/view/recommendation";

describe("recommendationLabel (#539)", () => {
  it("over/under com a linha e pass como 'Sem aposta' (ADR 0056)", () => {
    expect(recommendationLabel("over", "over_under", null, undefined, 2.5)).toBe("Mais de 2,5");
    expect(recommendationLabel("under", "over_under", null, undefined, 3.5)).toBe(
      "Menos de 3,5",
    );
    // Sem linha gravada: a linha padrão do mercado.
    expect(recommendationLabel("over", "over_under")).toBe("Mais de 2,5");
    expect(recommendationLabel("pass", "match_result")).toBe("Sem aposta");
    expect(PASS_LABEL).toBe("Sem aposta");
  });

  it("1X2, ambas marcam, dupla chance e placar usam o rótulo da apresentação", () => {
    expect(recommendationLabel("home", "match_result")).toBe("Casa");
    expect(recommendationLabel("draw", "match_result")).toBe("Empate");
    expect(recommendationLabel("away", "match_result")).toBe("Fora");
    expect(recommendationLabel("yes", "btts")).toBe("Sim");
    expect(recommendationLabel("home_or_draw", "double_chance")).toBe(
      "Casa ou empate"
    );
    expect(recommendationLabel("cs_2_1", "correct_score")).toBe("2-1");
  });

  it("apresentação vence o label do DB quando sabe rotular", () => {
    expect(recommendationLabel("home", "match_result", "Home")).toBe("Casa");
  });

  it("com teams (#574): nome ou sigla do time, mesmo com 'Casa' vindo do banco", () => {
    const teams = { home: "PAL", away: "FLA" };
    expect(recommendationLabel("home", "match_result", "Casa", teams)).toBe("PAL");
    expect(recommendationLabel("away", "match_result", null, teams)).toBe("FLA");
    expect(recommendationLabel("draw", "match_result", "Empate", teams)).toBe("Empate");
    expect(
      recommendationLabel("home_or_draw", "double_chance", "Casa ou empate", {
        home: "Palmeiras",
        away: "Flamengo",
      }),
    ).toBe("Palmeiras ou empate");
    expect(recommendationLabel("yes", "btts", "Sim", teams)).toBe("Sim");
    expect(recommendationLabel("over", "over_under", null, teams, 2.5)).toBe("Mais de 2,5");
  });

  it("artilheiro/assistência caem no label do DB (nome do jogador)", () => {
    expect(recommendationLabel("scorer_pedro", "anytime_scorer", "Pedro")).toBe(
      "Pedro"
    );
    expect(
      recommendationLabel("assist_arrascaeta", "assist", "Arrascaeta")
    ).toBe("Arrascaeta");
  });

  it("mercado sem apresentação não lança: usa o label do DB ou a key", () => {
    expect(recommendationLabel("x", "mercado_novo", "Rótulo")).toBe("Rótulo");
    expect(recommendationLabel("x", "mercado_novo")).toBe("x");
  });

  it("sem label nenhum devolve a key crua (row degradada)", () => {
    expect(recommendationLabel("scorer_pedro", "anytime_scorer", null)).toBe(
      "scorer_pedro"
    );
  });
});

describe("recommendationKind", () => {
  it("deriva do valor cru, nunca do rótulo", () => {
    expect(recommendationKind("over")).toBe("over");
    expect(recommendationKind("under")).toBe("under");
    expect(recommendationKind("pass")).toBe("pass");
    expect(recommendationKind("home")).toBe("other");
    expect(recommendationKind("Sem aposta")).toBe("other");
  });
});

describe("marketContextLabel", () => {
  it("anexa a linha quando o mercado tem uma", () => {
    expect(marketContextLabel("Total de gols", { line: 3.5 })).toBe(
      "Total de gols 3,5"
    );
  });

  it("não repete a linha que já está no rótulo da recomendação; mantém em 'Sem aposta'", () => {
    expect(marketContextLabel("Total de gols", { line: 2.5 }, "over")).toBe("Total de gols");
    expect(marketContextLabel("Total de gols", { line: 2.5 }, "pass")).toBe(
      "Total de gols 2,5",
    );
  });

  it("sem linha devolve só o mercado", () => {
    expect(marketContextLabel("Ambas marcam", null)).toBe("Ambas marcam");
  });
});
