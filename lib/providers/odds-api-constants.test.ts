import { describe, expect, it } from "vitest";

import {
  SPORT_KEYS,
  SPORT_KEY_BY_LEAGUE,
  leagueToSportKey,
} from "@/lib/providers/odds-api-constants";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";

describe("leagueToSportKey", () => {
  // Guards the regression the old per-call ternary allowed: any non-Brasileirão
  // league (incl. world_cup) silently fell through to the Champions sport key,
  // which compiles cleanly. typecheck can't catch a wrong *value*, so assert it.
  it("maps World Cup to the FIFA World Cup sport key (NOT Champions)", () => {
    expect(leagueToSportKey("world_cup")).toBe(SPORT_KEYS.WORLD_CUP);
    expect(leagueToSportKey("world_cup")).toBe("soccer_fifa_world_cup");
    expect(leagueToSportKey("world_cup")).not.toBe(SPORT_KEYS.CHAMPIONS_LEAGUE);
  });

  it("maps the club leagues to their own sport keys", () => {
    expect(leagueToSportKey("brasileirao_a")).toBe(SPORT_KEYS.BRASILEIRAO_A);
    expect(leagueToSportKey("champions_league")).toBe(
      SPORT_KEYS.CHAMPIONS_LEAGUE,
    );
  });

  it("covers every SupportedLeague with a distinct sport key", () => {
    for (const l of SUPPORTED_LEAGUES) {
      expect(SPORT_KEY_BY_LEAGUE[l]).toBeTypeOf("string");
    }
    const keys = SUPPORTED_LEAGUES.map((l) => leagueToSportKey(l));
    expect(new Set(keys).size).toBe(SUPPORTED_LEAGUES.length);
  });
});
