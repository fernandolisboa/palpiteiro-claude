import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

const getFixturesBySeason = vi.fn();
vi.mock("@/lib/providers/sports-data", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/providers/sports-data")>();
  return {
    ...actual,
    getSportsDataProvider: () => ({ getFixturesBySeason }),
  };
});

const replaceLeagueRatings = vi.fn();
vi.mock("@/lib/db/queries/team-ratings", () => ({
  replaceLeagueRatings: (...args: unknown[]) => replaceLeagueRatings(...args),
}));

const getActiveLeagues = vi.fn();
vi.mock("@/lib/db/queries/league-settings", () => ({
  getActiveLeagues: () => getActiveLeagues(),
}));

import {
  MIN_FIT_MATCHES,
  refitTeamRatings,
} from "@/lib/ratings/refit-team-ratings";

const NOW = new Date("2026-09-26T07:00:00Z");
const TEAMS = ["A", "B", "C", "D", "E", "F"];

// Round-robin determinístico: cada rodada todos se enfrentam uma vez; o placar
// depende do par pra dar força diferente aos times.
function season(
  league: SupportedLeague,
  year: number,
  rounds: number,
  status: NormalizedFixture["status"] = "finished"
): NormalizedFixture[] {
  const out: NormalizedFixture[] = [];
  let day = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < TEAMS.length; i++) {
      for (let j = 0; j < TEAMS.length; j++) {
        if (i === j) continue;
        day += 1;
        const ts = Date.UTC(year, 0, 1) + day * 3_600_000;
        out.push({
          id: `${league}:${year}:${r}:${i}:${j}`,
          league,
          kickoffAt: new Date(ts).toISOString(),
          kickoffTimestampMs: ts,
          homeTeam: TEAMS[i],
          awayTeam: TEAMS[j],
          status,
          score:
            status === "finished"
              ? { home: (i + r) % 4, away: (j * 2 + r) % 3 }
              : { home: null, away: null },
        });
      }
    }
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  replaceLeagueRatings.mockResolvedValue(undefined);
});

describe("refitTeamRatings", () => {
  it("busca a temporada atual e as 2 anteriores e grava o fit com os jogos finalizados", async () => {
    getFixturesBySeason.mockImplementation(
      (league: SupportedLeague, s: number) =>
        Promise.resolve(
          s === 2026
            ? [...season(league, s, 2), ...season(league, s, 1, "scheduled")]
            : season(league, s, 2)
        )
    );

    const [result] = await refitTeamRatings({
      leagues: ["brasileirao_a"],
      now: NOW,
    });

    expect(getFixturesBySeason.mock.calls.map((c) => c[1])).toEqual([
      2026, 2025, 2024,
    ]);
    // 3 temporadas × 2 rodadas × 30 jogos; os agendados ficam de fora.
    expect(result).toEqual({
      league: "brasileirao_a",
      status: "fitted",
      matchCount: 180,
      teamCount: 6,
      seasons: [2026, 2025, 2024],
      failedSeasons: [],
    });
    const write = replaceLeagueRatings.mock.calls[0][0];
    expect(write.league).toBe("brasileirao_a");
    expect(write.fittedAt).toBe(NOW);
    expect(write.matchCount).toBe(180);
    expect(write.teams).toHaveLength(6);
    for (const t of write.teams) {
      expect(t.matches).toBe(60);
      expect(Number.isFinite(t.attack) && t.attack > 0).toBe(true);
      expect(Number.isFinite(t.defence) && t.defence > 0).toBe(true);
    }
    expect(write.homeAdvantage).toBeGreaterThan(0);
    expect(Math.abs(write.rho)).toBeLessThanOrEqual(0.25);
  });

  it("temporada que falha é pulada; o fit sai com as outras e registra a falha", async () => {
    getFixturesBySeason.mockImplementation(
      (league: SupportedLeague, s: number) =>
        s === 2024
          ? Promise.reject(new Error("plan does not cover 2024"))
          : Promise.resolve(season(league, s, 2))
    );

    const [result] = await refitTeamRatings({
      leagues: ["brasileirao_a"],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "fitted",
      seasons: [2026, 2025],
      failedSeasons: [2024],
      matchCount: 120,
    });
  });

  it("poucos jogos → não grava (mantém o fit anterior)", async () => {
    getFixturesBySeason.mockImplementation(
      (league: SupportedLeague, s: number) =>
        Promise.resolve(s === 2026 ? season(league, s, 1) : [])
    );

    const [result] = await refitTeamRatings({
      leagues: ["premier_league"],
      now: NOW,
    });

    expect(result).toEqual({
      league: "premier_league",
      status: "skipped",
      reason: "too_few_matches",
      matchCount: 30,
      failedSeasons: [],
    });
    expect(30).toBeLessThan(MIN_FIT_MATCHES);
    expect(replaceLeagueRatings).not.toHaveBeenCalled();
  });

  it("todas as temporadas falham → skipped, sem escrita", async () => {
    getFixturesBySeason.mockRejectedValue(new Error("down"));

    const [result] = await refitTeamRatings({
      leagues: ["brasileirao_a"],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "all_seasons_failed",
    });
    expect(replaceLeagueRatings).not.toHaveBeenCalled();
  });

  it("falha na escrita de uma liga não derruba as outras", async () => {
    getFixturesBySeason.mockImplementation(
      (league: SupportedLeague, s: number) =>
        Promise.resolve(season(league, s, 2))
    );
    replaceLeagueRatings
      .mockRejectedValueOnce(new Error("neon down"))
      .mockResolvedValueOnce(undefined);

    const results = await refitTeamRatings({
      leagues: ["brasileirao_a", "la_liga"],
      now: NOW,
    });

    expect(results.map((r) => [r.league, r.status])).toEqual([
      ["brasileirao_a", "skipped"],
      ["la_liga", "fitted"],
    ]);
    expect(results[0]).toMatchObject({ reason: "write_failed" });
  });

  it("jogos futuros ou fora da janela de 3 anos não entram; duplicados contam uma vez", async () => {
    const base = season("brasileirao_a", 2025, 4);
    const future = season("brasileirao_a", 2027, 1);
    const ancient = season("brasileirao_a", 2020, 1);
    getFixturesBySeason.mockImplementation((_l: SupportedLeague, s: number) =>
      Promise.resolve(
        s === 2026 ? [...future, ...base] : s === 2025 ? base : ancient
      )
    );

    const [result] = await refitTeamRatings({
      leagues: ["brasileirao_a"],
      now: NOW,
    });

    expect(result).toMatchObject({ status: "fitted", matchCount: 120 });
  });

  it("sem opts.leagues usa as ligas ativas, menos a Copa do Mundo", async () => {
    getActiveLeagues.mockResolvedValue(["world_cup", "brasileirao_a"]);
    getFixturesBySeason.mockImplementation(
      (league: SupportedLeague, s: number) =>
        Promise.resolve(season(league, s, 2))
    );

    const results = await refitTeamRatings({ now: NOW });

    expect(results.map((r) => r.league)).toEqual(["brasileirao_a"]);
    expect(
      getFixturesBySeason.mock.calls.every((c) => c[0] === "brasileirao_a")
    ).toBe(true);
  });
});
