import { describe, expect, it } from "vitest";

import {
  ACTIVE_LEAGUE_KEYS,
  ACTIVE_LEAGUES,
  DEFAULT_LEAGUE_FILTER,
  defaultLeagueFilter,
  isActiveLeagueFilter,
  resolveHomeLeagueFilter,
} from "@/lib/config/active-leagues";

describe("active-leagues config", () => {
  it("ativa Brasileirão + Champions + Premier League + La Liga (#491, ADR 0045), Brasileirão primeiro", () => {
    expect(ACTIVE_LEAGUES).toEqual([
      "brasileirao_a",
      "champions_league",
      "premier_league",
      "la_liga",
    ]);
    expect(ACTIVE_LEAGUE_KEYS).toEqual(["bsa", "ucl", "epl", "laliga"]);
  });

  it("usa 'all' (Todos) como filtro default com >1 liga ativa", () => {
    expect(DEFAULT_LEAGUE_FILTER).toBe("all");
  });

  it("defaultLeagueFilter: 1 liga ativa → a própria liga; >1 → 'all'; vazio → throw", () => {
    expect(defaultLeagueFilter(["wc"])).toBe("wc");
    expect(defaultLeagueFilter(["bsa", "ucl"])).toBe("all");
    expect(() => defaultLeagueFilter([])).toThrow();
  });

  it("considera ativas só as keys de ligas ativas — Copa encerrada fica de fora", () => {
    expect(isActiveLeagueFilter("bsa")).toBe(true);
    expect(isActiveLeagueFilter("ucl")).toBe(true);
    expect(isActiveLeagueFilter("epl")).toBe(true);
    expect(isActiveLeagueFilter("wc")).toBe(false);
    expect(isActiveLeagueFilter("laliga")).toBe(true);
  });

  it("considera 'all' ativo quando há mais de uma liga ativa", () => {
    expect(isActiveLeagueFilter("all")).toBe(true);
  });
});

describe("resolveHomeLeagueFilter (?league= da home)", () => {
  it("sem param → default (Todos)", () => {
    expect(resolveHomeLeagueFilter(undefined)).toBe("all");
  });

  it("param inválido → liga default (nunca redirect → sem loop)", () => {
    expect(resolveHomeLeagueFilter("xyz")).toBe("all");
    expect(resolveHomeLeagueFilter("")).toBe("all");
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
