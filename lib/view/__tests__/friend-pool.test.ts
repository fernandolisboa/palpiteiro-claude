import { describe, expect, it } from "vitest";

import {
  joinNames,
  poolBetLabel,
  poolBetShortLabel,
  poolClosesIn,
  poolMatchLabel,
  poolStatusView,
} from "@/lib/view/friend-pool";
import { teamPair } from "@/lib/view/team";

const teams = { home: "Flamengo", away: "Palmeiras" };

describe("poolBetLabel", () => {
  it.each([
    ["exact_score", { home: 2, away: 1 }, "Flamengo 2 × 1 Palmeiras"],
    ["match_result", { selection: "away" }, "Vitória do Palmeiras"],
    ["match_result", { selection: "draw" }, "Empate"],
    ["double_chance", { selection: "home_draw" }, "Flamengo ou empate"],
    ["btts", { selection: "yes" }, "Os dois times marcam"],
    ["over_under", { selection: "over", line: 2.5 }, "Mais de 2,5 gols"],
  ] as const)("%s %j", (kind, params, label) => {
    expect(poolBetLabel(kind, params, teams)).toBe(label);
  });
});

describe("poolMatchLabel", () => {
  it("jogo, competição, data e hora", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const label = poolMatchLabel(
      {
        homeTeam: "Flamengo",
        awayTeam: "Palmeiras",
        league: "brasileirao_a",
        kickoffAt: new Date("2026-10-18T19:00:00Z"),
      },
      now,
      "America/Sao_Paulo",
    );
    expect(label).toBe("Flamengo × Palmeiras · Brasileirão · dom, 18 out, 16:00");
  });

  it("usa o nome curto, não o canonical (#578)", () => {
    const label = poolMatchLabel(
      {
        homeTeam: "SE Palmeiras",
        awayTeam: "SC Corinthians Paulista",
        league: "brasileirao_a",
        kickoffAt: new Date("2026-10-18T19:00:00Z"),
      },
      new Date("2026-10-13T12:00:00Z"),
      "America/Sao_Paulo",
    );
    expect(label.startsWith("Palmeiras × Corinthians · ")).toBe(true);
  });
});

describe("poolBetShortLabel (#577)", () => {
  const codes = { home: "FLA", away: "PAL" };

  it("placar com as siglas", () => {
    expect(poolBetShortLabel("exact_score", { home: 2, away: 1 }, teams, codes)).toBe(
      "FLA 2 × 1 PAL",
    );
  });

  it("sigla repetida sai desempatada pelo teamPair", () => {
    // Palmeiras × Palestino: as duas derivariam "PAL".
    const pair = teamPair("Palmeiras", "Palestino", "lib");
    const tied = { home: pair.home.short, away: pair.away.short };
    const label = poolBetShortLabel("exact_score", { home: 0, away: 0 }, teams, tied);
    expect(label).toBe("PAL 0 × 0 PLS");
  });

  it.each([
    ["match_result", { selection: "away" }],
    ["double_chance", { selection: "home_draw" }],
    ["btts", { selection: "no" }],
    ["over_under", { selection: "over", line: 2.5 }],
  ] as const)("%s igual ao poolBetLabel", (kind, params) => {
    expect(poolBetShortLabel(kind, params, teams, codes)).toBe(poolBetLabel(kind, params, teams));
  });
});

describe("poolStatusView (#577)", () => {
  const NOW = new Date("2026-10-18T15:00:00Z");
  const noManual = { manualHomeScore: null, manualAwayScore: null };
  const match = (over: Partial<{ status: string; kickoffAt: Date; homeScore: number | null; awayScore: number | null }> = {}) => ({
    status: "scheduled",
    kickoffAt: new Date(NOW.getTime() + 24 * 3_600_000),
    homeScore: null,
    awayScore: null,
    ...over,
  });

  it("aberto e longe da trava: destaque, sem hora", () => {
    expect(poolStatusView({ pool: noManual, match: match() }, NOW)).toEqual({
      label: "apostas abertas",
      tone: "open",
    });
  });

  it("aberto nas últimas 3h: âmbar com quanto falta", () => {
    const kickoffAt = new Date(NOW.getTime() + 2 * 3_600_000 + 10 * 60_000);
    expect(poolStatusView({ pool: noManual, match: match({ kickoffAt }) }, NOW)).toEqual({
      label: "fecham em 2h 10min",
      tone: "soon",
    });
  });

  it("último minuto antes da trava: 'fecham em menos de 1min', nunca 'em 0min'", () => {
    const kickoffAt = new Date(NOW.getTime() + 59_000);
    expect(poolStatusView({ pool: noManual, match: match({ kickoffAt }) }, NOW)).toEqual({
      label: "fecham em menos de 1min",
      tone: "soon",
    });
    expect(poolClosesIn(kickoffAt, NOW)).toBe("em menos de 1min");
  });

  it("3h exatas já conta; 3h01 ainda não", () => {
    const at = (ms: number) => match({ kickoffAt: new Date(NOW.getTime() + ms) });
    expect(poolStatusView({ pool: noManual, match: at(3 * 3_600_000) }, NOW).tone).toBe("soon");
    expect(poolStatusView({ pool: noManual, match: at(3 * 3_600_000 + 60_000) }, NOW).tone).toBe(
      "open",
    );
  });

  it("placar conhecido (do jogo ou lançado): neutro", () => {
    expect(
      poolStatusView(
        { pool: noManual, match: match({ status: "finished", homeScore: 3, awayScore: 1 }) },
        NOW,
      ),
    ).toEqual({ label: "placar 3 × 1", tone: "neutral" });
    expect(
      poolStatusView({ pool: { manualHomeScore: 0, manualAwayScore: 2 }, match: match() }, NOW),
    ).toEqual({ label: "placar 0 × 2", tone: "neutral" });
  });

  it.each([
    ["postponed", "jogo adiado"],
    ["cancelled", "jogo cancelado"],
  ])("%s: neutro", (status, label) => {
    expect(poolStatusView({ pool: noManual, match: match({ status }) }, NOW)).toEqual({
      label,
      tone: "neutral",
    });
  });

  it("apitado sem placar: esperando o placar", () => {
    const kickoffAt = new Date(NOW.getTime() - 3_600_000);
    expect(poolStatusView({ pool: noManual, match: match({ kickoffAt }) }, NOW)).toEqual({
      label: "esperando o placar",
      tone: "neutral",
    });
  });
});

describe("joinNames", () => {
  it.each([
    [[], ""],
    [["Ana"], "Ana"],
    [["Ana", "Bia"], "Ana e Bia"],
    [["Ana", "Bia", "Caio"], "Ana, Bia e Caio"],
  ])("%j", (names, out) => {
    expect(joinNames(names)).toBe(out);
  });
});
