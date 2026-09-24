import { describe, expect, it } from "vitest";

import { leaguePickerGroups } from "@/lib/view/league-picker";
import { parseLeagueFilter } from "@/lib/view/types";
import { keyToLeague, leagueToKey } from "@/lib/format";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";

const flat = (groups: ReturnType<typeof leaguePickerGroups>) =>
  groups.flatMap((g) => g.options);
// Só as opções habilitadas (liga de clube inativa aparece desabilitada).
const activeValues = (groups: ReturnType<typeof leaguePickerGroups>) =>
  flat(groups)
    .filter((o) => o.active)
    .map((o) => o.value);

describe("leaguePickerGroups", () => {
  it("config pós-Copa (bsa+ucl): 'Todas' primeiro, depois Brasil e Europa, sem Copa (#491)", () => {
    const groups = leaguePickerGroups(["bsa", "ucl"]);
    expect(groups.map((g) => g.label)).toEqual([null, "Brasil", "Europa"]);
    expect(activeValues(groups)).toEqual(["all", "bsa", "ucl"]);
  });

  it("usa a config real por default (ACTIVE_LEAGUE_KEYS)", () => {
    expect(activeValues(leaguePickerGroups())).toEqual(["all", "bsa", "ucl"]);
  });

  it("sem 'Todas' com uma liga ativa; liga de clube inativa fica desabilitada", () => {
    const options = flat(leaguePickerGroups(["bsa"]));
    expect(options.some((o) => o.value === "all")).toBe(false);
    expect(activeValues(leaguePickerGroups(["bsa"]))).toEqual(["bsa"]);
    expect(options.find((o) => o.value === "ucl")?.active).toBe(false);
  });

  it("torneio inativo some; ativo volta com seu grupo", () => {
    expect(flat(leaguePickerGroups(["bsa", "ucl"])).some((o) => o.value === "wc")).toBe(false);
    const groups = leaguePickerGroups(["wc", "bsa"]);
    expect(groups.map((g) => g.label)).toEqual([null, "Brasil", "Europa", "Seleções"]);
    const byValue = Object.fromEntries(flat(groups).map((o) => [o.value, o.active]));
    expect(byValue).toMatchObject({ all: true, bsa: true, ucl: false, wc: true });
  });

  it("toda liga suportada tem opção (escala com SUPPORTED_LEAGUES)", () => {
    const allKeys = SUPPORTED_LEAGUES.map(leagueToKey);
    const values = flat(leaguePickerGroups(allKeys)).map((o) => o.value);
    expect(values[0]).toBe("all");
    expect([...values.slice(1)].sort()).toEqual([...allKeys].sort());
  });

  it("copas CONMEBOL inativas somem; ativas ficam em América do Sul (ADR 0045)", () => {
    const values = flat(leaguePickerGroups(["bsa", "ucl"])).map((o) => o.value);
    expect(values).not.toContain("lib");
    expect(values).not.toContain("sula");

    const groups = leaguePickerGroups(["bsa", "lib", "sula"]);
    const southAmerica = groups.find((g) => g.label === "América do Sul");
    expect(southAmerica?.options).toEqual([
      { value: "lib", label: "Libertadores", active: true },
      { value: "sula", label: "Sul-Americana", active: true },
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
    expect(parseLeagueFilter("xyz")).toBe("all");
    expect(parseLeagueFilter(undefined)).toBe("all");
    expect(parseLeagueFilter(null)).toBe("all");
  });
});
