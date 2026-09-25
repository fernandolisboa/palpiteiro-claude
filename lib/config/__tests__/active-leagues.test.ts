import { describe, expect, it } from "vitest";

import {
  defaultLeagueFilter,
  FALLBACK_ACTIVE_LEAGUES,
  isActiveLeagueFilter,
  resolveHomeLeagueFilter,
} from "@/lib/config/active-leagues";
import type { LeagueKey } from "@/lib/view/types";

// Lista ativa injetada (a fonte de verdade é league_settings — ADR 0050).
const ACTIVE: readonly LeagueKey[] = ["bsa", "ucl", "epl", "laliga"];

describe("active-leagues (funções puras)", () => {
  it("fallback = Brasileirão + Champions", () => {
    expect(FALLBACK_ACTIVE_LEAGUES).toEqual([
      "brasileirao_a",
      "champions_league",
    ]);
  });

  it("defaultLeagueFilter: 1 liga ativa → a própria liga; >1 → 'all'; vazio → throw", () => {
    expect(defaultLeagueFilter(["wc"])).toBe("wc");
    expect(defaultLeagueFilter(["bsa", "ucl"])).toBe("all");
    expect(() => defaultLeagueFilter([])).toThrow();
  });

  it("considera ativas só as keys da lista — Copa encerrada fica de fora", () => {
    expect(isActiveLeagueFilter("bsa", ACTIVE)).toBe(true);
    expect(isActiveLeagueFilter("ucl", ACTIVE)).toBe(true);
    expect(isActiveLeagueFilter("epl", ACTIVE)).toBe(true);
    expect(isActiveLeagueFilter("laliga", ACTIVE)).toBe(true);
    expect(isActiveLeagueFilter("wc", ACTIVE)).toBe(false);
  });

  it("'all' só é ativo com mais de uma liga ativa", () => {
    expect(isActiveLeagueFilter("all", ACTIVE)).toBe(true);
    expect(isActiveLeagueFilter("all", ["bsa"])).toBe(false);
  });
});

describe("resolveHomeLeagueFilter (?league= da home)", () => {
  it("sem param → default (Todos)", () => {
    expect(resolveHomeLeagueFilter(undefined, ACTIVE)).toBe("all");
  });

  it("param inválido → liga default (nunca redirect → sem loop)", () => {
    expect(resolveHomeLeagueFilter("xyz", ACTIVE)).toBe("all");
    expect(resolveHomeLeagueFilter("", ACTIVE)).toBe("all");
  });

  it("ligas ativas passam", () => {
    expect(resolveHomeLeagueFilter("bsa", ACTIVE)).toBe("bsa");
    expect(resolveHomeLeagueFilter("ucl", ACTIVE)).toBe("ucl");
  });

  it("?league=all explícito → aba 'Todos'", () => {
    expect(resolveHomeLeagueFilter("all", ACTIVE)).toBe("all");
  });

  it("?league=wc (bookmark da Copa encerrada) → null (redirect pra /jogos)", () => {
    expect(resolveHomeLeagueFilter("wc", ACTIVE)).toBeNull();
  });

  it("com 1 liga ativa: sem param → a própria liga; ?league=all → null", () => {
    expect(resolveHomeLeagueFilter(undefined, ["bsa"])).toBe("bsa");
    expect(resolveHomeLeagueFilter("all", ["bsa"])).toBeNull();
  });

  it("liga desligada no admin (ex.: laliga) vira redirect", () => {
    expect(resolveHomeLeagueFilter("laliga", ["bsa", "ucl"])).toBeNull();
  });
});
