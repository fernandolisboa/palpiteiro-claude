import { describe, expect, it } from "vitest";

import {
  ACTIVE_LEAGUE_KEYS,
  ACTIVE_LEAGUES,
  DEFAULT_LEAGUE_FILTER,
  isActiveLeagueFilter,
  resolveHomeLeagueFilter,
} from "@/lib/config/active-leagues";

describe("active-leagues config", () => {
  it("ativa Brasileirão + Champions (pós-Copa, #491), Brasileirão primeiro", () => {
    expect(ACTIVE_LEAGUES).toEqual(["brasileirao_a", "champions_league"]);
    expect(ACTIVE_LEAGUE_KEYS).toEqual(["bsa", "ucl"]);
  });

  it("usa 'bsa' (primeira liga ativa) como filtro default", () => {
    expect(DEFAULT_LEAGUE_FILTER).toBe("bsa");
  });

  it("considera ativas só as keys de ligas ativas — Copa encerrada fica de fora", () => {
    expect(isActiveLeagueFilter("bsa")).toBe(true);
    expect(isActiveLeagueFilter("ucl")).toBe(true);
    expect(isActiveLeagueFilter("wc")).toBe(false);
  });

  it("considera 'all' ativo quando há mais de uma liga ativa", () => {
    expect(isActiveLeagueFilter("all")).toBe(true);
  });
});

describe("resolveHomeLeagueFilter (?league= da home)", () => {
  it("sem param → liga default (bsa)", () => {
    expect(resolveHomeLeagueFilter(undefined)).toBe("bsa");
  });

  it("param inválido → liga default (nunca redirect → sem loop)", () => {
    expect(resolveHomeLeagueFilter("xyz")).toBe("bsa");
    expect(resolveHomeLeagueFilter("")).toBe("bsa");
  });

  it("ligas ativas passam", () => {
    expect(resolveHomeLeagueFilter("bsa")).toBe("bsa");
    expect(resolveHomeLeagueFilter("ucl")).toBe("ucl");
  });

  it("?league=all explícito → aba 'Todos'", () => {
    expect(resolveHomeLeagueFilter("all")).toBe("all");
  });

  it("?league=wc (bookmark da Copa encerrada) → null (redirect pra /jogos)", () => {
    expect(resolveHomeLeagueFilter("wc")).toBeNull();
  });
});
