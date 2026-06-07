import { describe, expect, it } from "vitest";

import {
  ACTIVE_LEAGUE_KEYS,
  ACTIVE_LEAGUES,
  DEFAULT_LEAGUE_FILTER,
  LIST_WINDOW_HOURS,
  SYNC_HORIZON_DAYS,
  isActiveLeagueFilter,
} from "@/lib/config/active-leagues";

describe("active-leagues config", () => {
  it("ativa só a Copa do Mundo", () => {
    expect(ACTIVE_LEAGUES).toEqual(["world_cup"]);
    expect(ACTIVE_LEAGUE_KEYS).toEqual(["wc"]);
  });

  it("usa 'wc' como filtro default", () => {
    expect(DEFAULT_LEAGUE_FILTER).toBe("wc");
  });

  it("considera ativa só a key de liga ativa", () => {
    expect(isActiveLeagueFilter("wc")).toBe(true);
    expect(isActiveLeagueFilter("bsa")).toBe(false);
    expect(isActiveLeagueFilter("ucl")).toBe(false);
  });

  it("não considera 'all' ativo quando há só uma liga ativa", () => {
    expect(isActiveLeagueFilter("all")).toBe(false);
  });

  it("deriva o horizonte de sync da janela da lista (cobre 120h)", () => {
    expect(SYNC_HORIZON_DAYS * 24).toBeGreaterThanOrEqual(LIST_WINDOW_HOURS);
    expect(SYNC_HORIZON_DAYS).toBe(Math.ceil(LIST_WINDOW_HOURS / 24) + 1);
  });
});
