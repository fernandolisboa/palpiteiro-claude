import { describe, expect, it } from "vitest";

import { parseRangeParams } from "@/lib/view/date-range";
import {
  buildFiltersHref,
  buildLeagueHref,
  buildRangeHref,
  rangeEmptyMessage,
  rangeLabel,
} from "@/lib/view/range-href";

describe("buildRangeHref", () => {
  it("lista padrão com liga 'all' → league=all EXPLÍCITO (sem param = liga default, não Todos — #491)", () => {
    expect(buildRangeHref({ league: "all" }, { preset: "upcoming" })).toBe(
      "/jogos?league=all",
    );
  });

  it("lista padrão preserva a liga e não escreve preset", () => {
    expect(buildRangeHref({ league: "wc" }, { preset: "upcoming" })).toBe(
      "/jogos?league=wc",
    );
  });

  it("custom inclui from/to e preserva liga", () => {
    expect(
      buildRangeHref(
        { league: "wc" },
        { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
      ),
    ).toBe("/jogos?league=wc&preset=custom&from=2026-06-10&to=2026-06-20");
  });

  it("custom com liga 'all' mantém league=all", () => {
    expect(
      buildRangeHref(
        { league: "all" },
        { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
      ),
    ).toBe("/jogos?league=all&preset=custom&from=2026-06-10&to=2026-06-20");
  });
});

describe("buildLeagueHref", () => {
  it("lista padrão → não escreve preset, só a liga", () => {
    expect(buildLeagueHref({ preset: "upcoming" }, "wc")).toBe("/jogos?league=wc");
  });

  it("preserva um range custom com from/to ao trocar liga", () => {
    expect(
      buildLeagueHref(
        { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
        "bsa",
      ),
    ).toBe("/jogos?league=bsa&preset=custom&from=2026-06-10&to=2026-06-20");
  });

  it("trocar pra 'all' escreve league=all e mantém o range custom", () => {
    expect(
      buildLeagueHref({ preset: "custom", from: "2026-06-10", to: "2026-06-20" }, "all"),
    ).toBe("/jogos?league=all&preset=custom&from=2026-06-10&to=2026-06-20");
  });

  it("custom sem from/to válidos degrada pro default", () => {
    expect(buildLeagueHref({ preset: "custom" }, "wc")).toBe("/jogos?league=wc");
  });
});

describe("rangeLabel", () => {
  const now = new Date("2026-06-11T12:00:00.000Z");

  it("lista padrão → 'Próximos jogos'", () => {
    expect(rangeLabel(parseRangeParams({}, now))).toBe("Próximos jogos");
  });

  it("custom → 'DD/MM – DD/MM' (UTC)", () => {
    const range = parseRangeParams(
      { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
      now,
    );
    expect(rangeLabel(range)).toBe("10/06 – 20/06");
  });

  it("custom no fuso do usuário: os dias escolhidos, não os do UTC", () => {
    for (const tz of ["America/Sao_Paulo", "Asia/Tokyo"]) {
      const range = parseRangeParams(
        { preset: "custom", from: "2026-10-18", to: "2026-10-25" },
        now,
        tz,
      );
      expect(rangeLabel(range)).toBe("18/10 – 25/10");
    }
  });
});

describe("rangeEmptyMessage", () => {
  const now = new Date("2026-06-11T12:00:00.000Z");

  it("lista padrão → 'Nenhum jogo marcado', apontando pro Escolher datas", () => {
    const msg = rangeEmptyMessage(parseRangeParams({ preset: "upcoming" }, now));
    expect(msg.title).toBe("Nenhum jogo marcado");
    expect(msg.detail).toContain("Escolher datas");
  });

  it("custom → 'Nenhum jogo nesse período'", () => {
    const msg = rangeEmptyMessage(
      parseRangeParams(
        { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
        now,
      ),
    );
    expect(msg.title).toBe("Nenhum jogo nesse período");
  });
});

describe("filtros da lista na URL (#643)", () => {
  const filters = { q: "flamengo sábado", team: "CR Flamengo", analyzed: "no" as const };

  it("trocar a liga preserva busca, time e analisados", () => {
    expect(buildLeagueHref({ preset: "upcoming", filters }, "lib")).toBe(
      "/jogos?league=lib&q=flamengo+s%C3%A1bado&team=CR+Flamengo&analyzed=no",
    );
  });

  it("escolher ou limpar datas preserva os filtros", () => {
    expect(
      buildRangeHref(
        { league: "all", filters },
        { preset: "custom", from: "2026-10-24", to: "2026-10-26" },
      ),
    ).toBe(
      "/jogos?league=all&preset=custom&from=2026-10-24&to=2026-10-26&q=flamengo+s%C3%A1bado&team=CR+Flamengo&analyzed=no",
    );
  });

  it("valor padrão não vai na URL", () => {
    expect(
      buildLeagueHref({ preset: "upcoming", filters: { q: "", analyzed: "all" } }, "all"),
    ).toBe("/jogos?league=all");
  });

  it("buildFiltersHref troca só as chaves do patch, preservando liga e datas", () => {
    const nav = {
      league: "bsa" as const,
      preset: "custom" as const,
      from: "2026-10-24",
      to: "2026-10-26",
      filters,
    };
    expect(buildFiltersHref(nav, { team: undefined })).toBe(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26&q=flamengo+s%C3%A1bado&analyzed=no",
    );
    expect(buildFiltersHref(nav, { q: undefined, team: undefined, analyzed: "all" })).toBe(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26",
    );
  });
});
