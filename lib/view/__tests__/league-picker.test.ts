import { describe, expect, it } from "vitest";

import { leaguePickerGroups } from "@/lib/view/league-picker";
import { parseLeagueFilter } from "@/lib/view/types";
import { keyToLeague, leagueToKey } from "@/lib/format";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";

const flat = (groups: ReturnType<typeof leaguePickerGroups>) =>
  groups.flatMap((g) => g.options);
const values = (groups: ReturnType<typeof leaguePickerGroups>) =>
  flat(groups).map((o) => o.value);

describe("leaguePickerGroups", () => {
  it("bsa+ucl: 'Todas' primeiro, depois Brasil e Europa, sem Copa (#491)", () => {
    const groups = leaguePickerGroups(["bsa", "ucl"]);
    expect(groups.map((g) => g.label)).toEqual([null, "Brasil", "Europa"]);
    expect(values(groups)).toEqual(["all", "bsa", "ucl"]);
  });

  it("só ligas ativas viram opção — inativa some, sem estado desabilitado (ADR 0050)", () => {
    const groups = leaguePickerGroups(["bsa", "ucl"]);
    for (const k of ["epl", "laliga", "wc", "sa", "bl", "l1", "lib", "sula"]) {
      expect(values(groups)).not.toContain(k);
    }
    expect(flat(groups).every((o) => !("active" in o))).toBe(true);
  });

  it("sem 'Todas' e sem rótulo de grupo com uma liga ativa", () => {
    const groups = leaguePickerGroups(["bsa"]);
    expect(groups).toEqual([{ label: null, options: [{ value: "bsa", label: "Brasileirão" }] }]);
  });

  it("torneio ativo volta com seu grupo", () => {
    const groups = leaguePickerGroups(["wc", "bsa"]);
    expect(groups.map((g) => g.label)).toEqual([null, "Brasil", "Seleções"]);
    expect(values(groups)).toEqual(["all", "bsa", "wc"]);
  });

  it("Premier League e La Liga aparecem em Europa quando ativas (ADR 0049)", () => {
    const groups = leaguePickerGroups(["bsa", "ucl", "epl", "laliga"]);
    const europa = groups.find((g) => g.label === "Europa");
    expect(europa?.options.map((o) => [o.value, o.label])).toEqual([
      ["ucl", "Champions"],
      ["epl", "Premier League"],
      ["laliga", "La Liga"],
    ]);
  });

  it("toda liga suportada tem opção quando ativa (escala com SUPPORTED_LEAGUES)", () => {
    const allKeys = SUPPORTED_LEAGUES.map(leagueToKey);
    const vals = values(leaguePickerGroups(allKeys));
    // Ordem = grupo de região (Seleções por último), não a de SUPPORTED_LEAGUES.
    expect(vals[0]).toBe("all");
    expect([...vals.slice(1)].sort()).toEqual([...allKeys].sort());
  });

  it("copas CONMEBOL ativas ficam em América do Sul (ADR 0045)", () => {
    const groups = leaguePickerGroups(["bsa", "lib", "sula"]);
    const southAmerica = groups.find((g) => g.label === "América do Sul");
    expect(southAmerica?.options).toEqual([
      { value: "lib", label: "Libertadores" },
      { value: "sula", label: "Sul-Americana" },
    ]);
  });
});

describe("league key round-trip", () => {
  it("keyToLeague inverte leagueToKey pra toda liga suportada", () => {
    for (const league of SUPPORTED_LEAGUES) {
      expect(keyToLeague(leagueToKey(league))).toBe(league);
    }
  });

  it("parseLeagueFilter aceita keys conhecidas e cai pra 'all' no resto", () => {
    expect(parseLeagueFilter("ucl")).toBe("ucl");
    expect(parseLeagueFilter("l1")).toBe("l1");
    expect(parseLeagueFilter("xyz")).toBe("all");
    expect(parseLeagueFilter(undefined)).toBe("all");
    expect(parseLeagueFilter(null)).toBe("all");
  });
});
