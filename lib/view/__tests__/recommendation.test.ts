import { describe, expect, it } from "vitest";

import {
  marketContextLabel,
  recommendationLabel,
} from "@/lib/view/recommendation";

describe("recommendationLabel (#539)", () => {
  it("over/under/pass mantêm o token pinado", () => {
    expect(recommendationLabel("over", "over_under")).toBe("OVER");
    expect(recommendationLabel("under", "over_under")).toBe("UNDER");
    expect(recommendationLabel("pass", "match_result")).toBe("PASS");
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

describe("marketContextLabel", () => {
  it("anexa a linha quando o mercado tem uma", () => {
    expect(marketContextLabel("Over/Under gols", { line: 3.5 })).toBe(
      "Over/Under gols 3.5"
    );
  });

  it("sem linha devolve só o mercado", () => {
    expect(marketContextLabel("Ambas marcam", null)).toBe("Ambas marcam");
  });
});
