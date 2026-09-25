import { describe, expect, it } from "vitest";

import {
  LeagueToggleInputSchema,
  validateLeagueToggle,
} from "@/lib/config/league-activation";
import {
  estimateMonthlyOddsCredits,
  ODDS_CREDITS_PER_MONTH_ESTIMATE,
} from "@/lib/config/odds-credits";

describe("validateLeagueToggle (ADR 0050)", () => {
  it("desliga uma liga quando sobra outra ativa", () => {
    expect(
      validateLeagueToggle({
        league: "la_liga",
        active: false,
        currentActive: ["brasileirao_a", "la_liga"],
        canonicalTeamCount: 20,
      })
    ).toEqual({ ok: true });
  });

  it("recusa desligar a última liga ativa", () => {
    const r = validateLeagueToggle({
      league: "brasileirao_a",
      active: false,
      currentActive: ["brasileirao_a"],
      canonicalTeamCount: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/última liga ativa/);
  });

  it("desligar liga já desligada é no-op permitido (mesmo com uma só ativa)", () => {
    expect(
      validateLeagueToggle({
        league: "serie_a",
        active: false,
        currentActive: ["brasileirao_a"],
        canonicalTeamCount: 0,
      }).ok
    ).toBe(true);
  });

  it("recusa ligar liga sem times canônicos, apontando o script", () => {
    const r = validateLeagueToggle({
      league: "serie_a",
      active: true,
      currentActive: ["brasileirao_a"],
      canonicalTeamCount: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/scripts\/generate-team-ids\.ts/);
  });

  it("liga liga com times semeados", () => {
    expect(
      validateLeagueToggle({
        league: "premier_league",
        active: true,
        currentActive: ["brasileirao_a"],
        canonicalTeamCount: 20,
      }).ok
    ).toBe(true);
  });

  it("ligar liga já ligada é no-op permitido", () => {
    expect(
      validateLeagueToggle({
        league: "brasileirao_a",
        active: true,
        currentActive: ["brasileirao_a"],
        canonicalTeamCount: 0,
      }).ok
    ).toBe(true);
  });
});

describe("LeagueToggleInputSchema", () => {
  it("aceita liga suportada + boolean", () => {
    expect(
      LeagueToggleInputSchema.safeParse({ league: "la_liga", active: true })
        .success
    ).toBe(true);
  });

  it("recusa liga desconhecida ou active não-boolean", () => {
    expect(
      LeagueToggleInputSchema.safeParse({ league: "mls", active: true }).success
    ).toBe(false);
    expect(
      LeagueToggleInputSchema.safeParse({ league: "la_liga", active: "true" })
        .success
    ).toBe(false);
  });
});

describe("estimateMonthlyOddsCredits", () => {
  it("soma a estimativa das ligas ativas", () => {
    expect(
      estimateMonthlyOddsCredits([
        "brasileirao_a",
        "champions_league",
        "premier_league",
        "la_liga",
      ])
    ).toBe(475);
    expect(estimateMonthlyOddsCredits([])).toBe(0);
  });

  it("toda estimativa é inteiro não-negativo", () => {
    for (const v of Object.values(ODDS_CREDITS_PER_MONTH_ESTIMATE)) {
      expect(Number.isInteger(v) && v >= 0).toBe(true);
    }
  });
});
