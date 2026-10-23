import { describe, expect, it } from "vitest";

import type { TeamCatalogEntry } from "@/lib/db/queries/matches";
import {
  buildSearchTerms,
  filteredEmptyMessage,
  foldText,
  hasActiveFilters,
  normalizeQuery,
  parseListFilters,
  selectedTeamOption,
  teamOptionGroups,
  tokenizeQuery,
} from "@/lib/view/match-search";

const CATALOG: TeamCatalogEntry[] = [
  { name: "CR Flamengo", league: "brasileirao_a", crestUrl: "https://x/127.png" },
  { name: "SE Palmeiras", league: "brasileirao_a", crestUrl: null },
  { name: "Grêmio FBPA", league: "brasileirao_a", crestUrl: null },
  { name: "São Paulo FC", league: "brasileirao_a", crestUrl: null },
  { name: "SC Internacional", league: "brasileirao_a", crestUrl: null },
  { name: "CR Flamengo", league: "copa_libertadores", crestUrl: null },
  { name: "Paris Saint-Germain FC", league: "champions_league", crestUrl: null },
  { name: "FC Internazionale Milano", league: "champions_league", crestUrl: null },
];

const LEAGUES = [
  "brasileirao_a",
  "champions_league",
  "premier_league",
  "la_liga",
  "copa_libertadores",
] as const;

function terms(q: string) {
  return buildSearchTerms({ q, catalog: CATALOG, leagues: LEAGUES, todayKey: "2026-10-23" });
}

describe("parseListFilters (#643)", () => {
  it("sem params: nenhum filtro", () => {
    expect(parseListFilters({})).toEqual({ q: undefined, team: undefined, analyzed: "all" });
  });

  it("colapsa espaços, corta no teto e ignora valor inválido", () => {
    const f = parseListFilters({ q: "  flamengo   sábado ", team: " CR Flamengo ", analyzed: "talvez" });
    expect(f).toEqual({ q: "flamengo sábado", team: "CR Flamengo", analyzed: "all" });
    expect(parseListFilters({ q: "a".repeat(200) }).q).toHaveLength(80);
    expect(parseListFilters({ q: "   " }).q).toBeUndefined();
  });

  it("aceita analyzed=yes|no", () => {
    expect(parseListFilters({ analyzed: "yes" }).analyzed).toBe("yes");
    expect(parseListFilters({ analyzed: "no" }).analyzed).toBe("no");
  });

  it("hasActiveFilters", () => {
    expect(hasActiveFilters({ analyzed: "all" })).toBe(false);
    expect(hasActiveFilters({ q: "x" })).toBe(true);
    expect(hasActiveFilters({ team: "CR Flamengo" })).toBe(true);
    expect(hasActiveFilters({ analyzed: "no" })).toBe(true);
  });

  it("normalizeQuery", () => {
    expect(normalizeQuery(undefined)).toBeUndefined();
    expect(normalizeQuery(" a  b ")).toBe("a b");
  });
});

describe("tokenizeQuery", () => {
  it("minúsculas, sem acento, sem separador entre times e sem repetição", () => {
    expect(tokenizeQuery("Grêmio x São Paulo vs GRÊMIO")).toEqual(["gremio", "sao", "paulo"]);
  });

  it("tira pontuação das pontas, mantém a barra da data e o -feira", () => {
    expect(tokenizeQuery('"Flamengo", sábado. 25/10 segunda-feira')).toEqual([
      "flamengo",
      "sabado",
      "25/10",
      "segunda",
    ]);
  });

  it("foldText", () => {
    expect(foldText("Amanhã ÀS")).toBe("amanha as");
  });
});

describe("buildSearchTerms", () => {
  it("time pelo nome canônico, sem acento", () => {
    expect(terms("gremio")).toEqual([{ kind: "text", teams: ["Grêmio FBPA"], leagues: [] }]);
  });

  it("time pelo nome de exibição e pela sigla", () => {
    expect(terms("psg")[0]).toMatchObject({ teams: ["Paris Saint-Germain FC"] });
  });

  it("termo que casa time de duas ligas e a competição traz tudo", () => {
    expect(terms("inter")[0]).toMatchObject({
      teams: ["SC Internacional", "FC Internazionale Milano"],
    });
    expect(terms("libertadores")[0]).toEqual({
      kind: "text",
      teams: [],
      leagues: ["copa_libertadores"],
    });
    expect(terms("brasileiro")[0]).toMatchObject({ leagues: ["brasileirao_a"] });
    expect(terms("epl")[0]).toMatchObject({ leagues: ["premier_league"] });
  });

  it("nome de dois termos: cada um vira um termo (AND)", () => {
    expect(terms("são paulo")).toEqual([
      { kind: "text", teams: ["São Paulo FC"], leagues: [] },
      { kind: "text", teams: ["São Paulo FC"], leagues: [] },
    ]);
  });

  it("termo que não casa nada fica com listas vazias (nenhum jogo)", () => {
    expect(terms("zzz")).toEqual([{ kind: "text", teams: [], leagues: [] }]);
  });

  it("datas: dia/mês, com ano, hoje/amanhã/ontem e dia da semana", () => {
    expect(terms("25/10")).toEqual([{ kind: "dayMonth", dayMonth: "25/10" }]);
    expect(terms("5-1")).toEqual([{ kind: "dayMonth", dayMonth: "05/01" }]);
    expect(terms("25/10/2026")).toEqual([{ kind: "day", day: "2026-10-25" }]);
    expect(terms("25/10/26")).toEqual([{ kind: "day", day: "2026-10-25" }]);
    expect(terms("hoje")).toEqual([{ kind: "day", day: "2026-10-23" }]);
    expect(terms("amanhã")).toEqual([{ kind: "day", day: "2026-10-24" }]);
    expect(terms("ontem")).toEqual([{ kind: "day", day: "2026-10-22" }]);
    expect(terms("sábado")).toEqual([{ kind: "weekday", isoDow: 6 }]);
    expect(terms("dom")).toEqual([{ kind: "weekday", isoDow: 7 }]);
    expect(terms("terça-feira")).toEqual([{ kind: "weekday", isoDow: 2 }]);
  });

  it("amanhã na virada do mês e do ano", () => {
    expect(
      buildSearchTerms({ q: "amanha", catalog: [], leagues: [], todayKey: "2026-12-31" }),
    ).toEqual([{ kind: "day", day: "2027-01-01" }]);
  });

  it("data impossível não é data", () => {
    expect(terms("31/02")[0]).toMatchObject({ kind: "text" });
    expect(terms("29/02/2027")[0]).toMatchObject({ kind: "text" });
    expect(terms("29/02")).toEqual([{ kind: "dayMonth", dayMonth: "29/02" }]);
  });

  it("time + dia da semana", () => {
    expect(terms("Flamengo x sábado")).toEqual([
      { kind: "text", teams: ["CR Flamengo"], leagues: [] },
      { kind: "weekday", isoDow: 6 },
    ]);
  });
});

describe("teamOptionGroups / selectedTeamOption", () => {
  it("agrupa na ordem das ligas e ordena pelo nome de exibição", () => {
    const groups = teamOptionGroups(CATALOG, ["lib", "bsa", "ucl"]);
    expect(groups.map((g) => g.league)).toEqual(["lib", "bsa", "ucl"]);
    expect(groups[1].teams.map((t) => t.team.name)).toEqual([
      "Flamengo",
      "Grêmio",
      "Internacional",
      "Palmeiras",
      "São Paulo",
    ]);
    expect(groups[1].teams[0]).toMatchObject({
      value: "CR Flamengo",
      team: { crestUrl: "https://x/127.png" },
    });
  });

  it("liga fora da ordem (inativa) não aparece", () => {
    expect(teamOptionGroups(CATALOG, ["bsa"]).map((g) => g.league)).toEqual(["bsa"]);
  });

  it("o escolhido prefere a entrada com escudo; fora do catálogo ainda tem nome", () => {
    expect(selectedTeamOption(CATALOG, "CR Flamengo", "bsa")?.team.crestUrl).toBe(
      "https://x/127.png",
    );
    expect(selectedTeamOption(CATALOG, "Santos FC", "bsa")).toMatchObject({
      value: "Santos FC",
      team: { name: "Santos" },
    });
    expect(selectedTeamOption(CATALOG, undefined, "bsa")).toBeUndefined();
  });
});

describe("filteredEmptyMessage", () => {
  it("lista o que foi buscado", () => {
    expect(
      filteredEmptyMessage({ q: "sábado", team: "CR Flamengo", analyzed: "no" }, "Flamengo"),
    ).toEqual({
      title: "Nenhum jogo encontrado",
      detail:
        'Nada com "sábado" + Flamengo + não analisados neste período. Tente outro termo ou limpe os filtros.',
    });
  });
});
