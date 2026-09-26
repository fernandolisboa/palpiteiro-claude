import { replaceLeagueRatings } from "@/lib/db/queries/team-ratings";
import { getActiveLeagues } from "@/lib/db/queries/league-settings";
import {
  currentSeason,
  getSportsDataProvider,
} from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";
import {
  DC_DEFAULTS,
  fitDixonColes,
  type DcMatch,
} from "@/lib/quant/dixon-coles";

// Refit diário do Dixon-Coles (ADR 0051). Pra cada liga ativa: temporada atual + as
// duas anteriores (a janela do fit é 3 anos) via getFixturesBySeason — 3 chamadas de
// API-Football por liga, zero crédito da The Odds API — → fitDixonColes com os
// hiperparâmetros do backtest (DC_DEFAULTS) → troca atômica dos ratings da liga.
// Liga que falha mantém o fit anterior; o predict larga o DC sozinho quando ele fica
// velho (DC_MAX_FIT_AGE_MS).

const SEASONS_BACK = 2;
// Abaixo disso o ajuste é quase só o prior; não sobrescreve um fit bom com um ruim
// (ex.: só a temporada atual respondeu, no começo dela).
export const MIN_FIT_MATCHES = 100;
// Seleções nacionais: uma Copa a cada 4 anos não forma histórico de liga.
const EXCLUDED: ReadonlySet<SupportedLeague> = new Set(["world_cup"]);

export type LeagueRefitResult =
  | {
      league: SupportedLeague;
      status: "fitted";
      matchCount: number;
      teamCount: number;
      seasons: number[];
      failedSeasons: number[];
    }
  | {
      league: SupportedLeague;
      status: "skipped";
      reason: "too_few_matches" | "all_seasons_failed" | "write_failed";
      matchCount: number;
      failedSeasons: number[];
    };

function toDcMatches(fixtures: readonly NormalizedFixture[]): DcMatch[] {
  // Dedup por id: a mesma partida não pode entrar duas vezes se duas temporadas se
  // sobrepõem no provider.
  const byId = new Map<string, DcMatch>();
  for (const f of fixtures) {
    if (f.status !== "finished") continue;
    if (f.score.home === null || f.score.away === null) continue;
    byId.set(f.id, {
      date: new Date(f.kickoffTimestampMs),
      home: f.homeTeam,
      away: f.awayTeam,
      homeGoals: f.score.home,
      awayGoals: f.score.away,
    });
  }
  return [...byId.values()];
}

async function refitLeague(
  league: SupportedLeague,
  now: Date
): Promise<LeagueRefitResult> {
  const provider = getSportsDataProvider();
  const current = currentSeason(league, now);
  const seasons = Array.from(
    { length: SEASONS_BACK + 1 },
    (_, i) => current - i
  );
  const settled = await Promise.allSettled(
    seasons.map((s) => provider.getFixturesBySeason(league, s))
  );
  const okSeasons: number[] = [];
  const failedSeasons: number[] = [];
  const fixtures: NormalizedFixture[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      okSeasons.push(seasons[i]);
      fixtures.push(...r.value);
    } else {
      failedSeasons.push(seasons[i]);
      console.error(
        JSON.stringify({
          scope: "refit_team_ratings",
          event: "season_fetch_failed",
          league,
          season: seasons[i],
          message:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        })
      );
    }
  });
  if (okSeasons.length === 0) {
    return {
      league,
      status: "skipped",
      reason: "all_seasons_failed",
      matchCount: 0,
      failedSeasons,
    };
  }

  const cutoffMs = now.getTime() - DC_DEFAULTS.maxAgeDays * 86_400_000;
  const matches = toDcMatches(fixtures).filter((m) => {
    const t = m.date.getTime();
    return t < now.getTime() && t >= cutoffMs;
  });
  const model =
    matches.length >= MIN_FIT_MATCHES ? fitDixonColes(matches, now) : null;
  if (!model) {
    return {
      league,
      status: "skipped",
      reason: "too_few_matches",
      matchCount: matches.length,
      failedSeasons,
    };
  }

  const played = new Map<string, number>();
  for (const m of matches) {
    played.set(m.home, (played.get(m.home) ?? 0) + 1);
    played.set(m.away, (played.get(m.away) ?? 0) + 1);
  }
  const teams = [...model.attack.keys()].map((team) => ({
    team,
    attack: model.attack.get(team)!,
    defence: model.defence.get(team)!,
    matches: played.get(team) ?? 0,
  }));

  try {
    await replaceLeagueRatings({
      league,
      homeAdvantage: model.homeAdvantage,
      rho: model.rho,
      matchCount: matches.length,
      seasons: okSeasons,
      fittedAt: now,
      teams,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "refit_team_ratings",
        event: "write_failed",
        league,
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return {
      league,
      status: "skipped",
      reason: "write_failed",
      matchCount: matches.length,
      failedSeasons,
    };
  }
  return {
    league,
    status: "fitted",
    matchCount: matches.length,
    teamCount: teams.length,
    seasons: okSeasons,
    failedSeasons,
  };
}

/**
 * Refita todas as ligas ativas (ou `opts.leagues`). Liga a liga em série: são
 * poucas, o fit é de milissegundos, e série evita rajada no rate limit do provider.
 */
export async function refitTeamRatings(
  opts: { leagues?: readonly SupportedLeague[]; now?: Date } = {}
): Promise<LeagueRefitResult[]> {
  const now = opts.now ?? new Date();
  const leagues = (opts.leagues ?? (await getActiveLeagues())).filter(
    (l) => !EXCLUDED.has(l)
  );
  const results: LeagueRefitResult[] = [];
  for (const league of leagues) {
    results.push(await refitLeague(league, now));
  }
  console.log(
    JSON.stringify({
      scope: "refit_team_ratings",
      event: "run_complete",
      results,
    })
  );
  return results;
}
