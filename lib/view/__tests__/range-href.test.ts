import { describe, expect, it } from "vitest";

import { parseRangeParams } from "@/lib/view/date-range";
import {
  buildLeagueHref,
  buildRangeHref,
  rangeEmptyMessage,
  rangeLabel,
} from "@/lib/view/range-href";

describe("buildRangeHref", () => {
  it("today5 com liga 'all' → league=all EXPLÍCITO (sem param = liga default, não Todos — #491)", () => {
    expect(buildRangeHref({ league: "all" }, { preset: "today5" })).toBe(
      "/jogos?league=all",
    );
  });

  it("preserva a liga ao escolher um preset", () => {
    expect(buildRangeHref({ league: "wc" }, { preset: "today5" })).toBe(
      "/jogos?league=wc",
    );
  });

  it("today14 com liga", () => {
    expect(buildRangeHref({ league: "wc" }, { preset: "today14" })).toBe(
      "/jogos?league=wc&preset=today14",
    );
  });

  it("season com liga", () => {
    expect(buildRangeHref({ league: "bsa" }, { preset: "season" })).toBe(
      "/jogos?league=bsa&preset=season",
    );
  });

  it("season com liga 'all'", () => {
    expect(buildRangeHref({ league: "all" }, { preset: "season" })).toBe(
      "/jogos?league=all&preset=season",
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
  it("troca a liga preservando o preset today14", () => {
    expect(buildLeagueHref({ preset: "today14" }, "wc")).toBe(
      "/jogos?league=wc&preset=today14",
    );
  });

  it("today5 → não escreve preset, só a liga", () => {
    expect(buildLeagueHref({ preset: "today5" }, "wc")).toBe("/jogos?league=wc");
  });

  it("preserva um range custom com from/to ao trocar liga", () => {
    expect(
      buildLeagueHref(
        { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
        "bsa",
      ),
    ).toBe("/jogos?league=bsa&preset=custom&from=2026-06-10&to=2026-06-20");
  });

  it("trocar pra 'all' escreve league=all e mantém o preset", () => {
    expect(buildLeagueHref({ preset: "season" }, "all")).toBe(
      "/jogos?league=all&preset=season",
    );
  });

  it("custom sem from/to válidos degrada pro default today5", () => {
    expect(buildLeagueHref({ preset: "custom" }, "wc")).toBe("/jogos?league=wc");
  });
});

describe("rangeLabel", () => {
  const now = new Date("2026-06-11T12:00:00.000Z");

  it("today5 → 'Próximos 5 dias'", () => {
    expect(rangeLabel(parseRangeParams({ preset: "today5" }, now))).toBe(
      "Próximos 5 dias",
    );
  });

  it("today14 → 'Próximos 14 dias'", () => {
    expect(rangeLabel(parseRangeParams({ preset: "today14" }, now))).toBe(
      "Próximos 14 dias",
    );
  });

  it("season → 'Competição'", () => {
    expect(rangeLabel(parseRangeParams({ preset: "season" }, now))).toBe(
      "Competição",
    );
  });

  it("custom → 'DD/MM – DD/MM' (UTC)", () => {
    const range = parseRangeParams(
      { preset: "custom", from: "2026-06-10", to: "2026-06-20" },
      now,
    );
    expect(rangeLabel(range)).toBe("10/06 – 20/06");
  });
});

describe("rangeEmptyMessage", () => {
  const now = new Date("2026-06-11T12:00:00.000Z");

  it("preset de janela → mensagem 'volte mais perto'", () => {
    const msg = rangeEmptyMessage(parseRangeParams({ preset: "today5" }, now));
    expect(msg.title).toBe("Sem jogos — próximos 5 dias");
    expect(msg.detail).toContain("Volte mais perto");
  });

  it("season → mensagem específica de competição", () => {
    const msg = rangeEmptyMessage(parseRangeParams({ preset: "season" }, now));
    expect(msg.title).toBe("Nenhum jogo na competição");
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
