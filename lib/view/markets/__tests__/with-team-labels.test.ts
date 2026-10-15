import { describe, expect, it } from "vitest";

import { getMarketPresentation } from "@/lib/view/markets/presentation";
import { withTeamLabels } from "@/lib/view/markets/with-team-labels";

const TEAMS = { home: "Palmeiras", away: "Flamengo" };

describe("withTeamLabels (#574)", () => {
  it("1X2: mandante e visitante viram o nome do time, empate continua", () => {
    const p = withTeamLabels(getMarketPresentation("match_result"), TEAMS);
    expect(p.selectionLabel("home")).toBe("Palmeiras");
    expect(p.selectionLabel("draw")).toBe("Empate");
    expect(p.selectionLabel("away")).toBe("Flamengo");
    expect(p.outcomeLabel("home", null)).toBe("Palmeiras");
    expect(p.scenarioLabel("away", null)).toBe("Flamengo");
    expect(p.framingLabel("home", null)).toBe("Palmeiras");
    expect(p.betSummary("away", null)).toEqual({ market: "Flamengo", plain: "" });
    expect(p.marketLabel).toBe("Resultado (1X2)");
  });

  it("dupla chance: as mesmas frases da grade de apostas", () => {
    const p = withTeamLabels(getMarketPresentation("double_chance"), TEAMS);
    expect(p.selectionLabel("home_or_draw")).toBe("Palmeiras ou empate");
    expect(p.selectionLabel("away_or_draw")).toBe("Empate ou Flamengo");
    expect(p.selectionLabel("home_or_away")).toBe("Palmeiras ou Flamengo");
    expect(p.betSummary("home_or_draw", null).market).toBe("Palmeiras ou empate");
  });

  it("over/under e btts passam direto", () => {
    const ou = getMarketPresentation("over_under");
    const btts = getMarketPresentation("btts");
    expect(withTeamLabels(ou, TEAMS)).toBe(ou);
    expect(withTeamLabels(btts, TEAMS)).toBe(btts);
    expect(withTeamLabels(ou, TEAMS).outcomeLabel("over", 2.5)).toBe("Over 2.5");
  });

  it("sem teams devolve a presentation original", () => {
    const mr = getMarketPresentation("match_result");
    expect(withTeamLabels(mr, undefined)).toBe(mr);
  });

  it("seleção desconhecida cai no rótulo original", () => {
    const p = withTeamLabels(getMarketPresentation("match_result"), TEAMS);
    expect(p.selectionLabel("weird")).toBe("weird");
  });

  it("não muta a presentation do registry", () => {
    withTeamLabels(getMarketPresentation("match_result"), TEAMS);
    withTeamLabels(getMarketPresentation("double_chance"), TEAMS);
    expect(getMarketPresentation("match_result").selectionLabel("home")).toBe("Casa");
    expect(getMarketPresentation("double_chance").selectionLabel("home_or_draw")).toBe(
      "Casa ou empate",
    );
  });
});
