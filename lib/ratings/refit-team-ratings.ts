import type { SeasonResult } from "@/db/schema";
import { getActiveLeagues } from "@/lib/db/queries/league-settings";
import {
  getCachedSeasonResults,
  getLeagueFitInfo,
  replaceLeagueRatings,
  saveSeasonResults,
} from "@/lib/db/queries/team-ratings";
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
import { DC_MAX_FIT_AGE_MS } from "@/lib/quant/match-model";

// Refit diário do Dixon-Coles (ADR 0051). Pra cada liga ativa: temporada atual + as
// três anteriores (cobrem a janela de 3 anos do fit inteira, como no backtest) →
// fitDixonColes com os hiperparâmetros do backtest (DC_DEFAULTS) → troca atômica dos
// ratings da liga. Temporada encerrada não muda: é buscada no provider uma vez e
// guardada (team_rating_season_results) quando o provider a devolve completa, então
// o dia a dia custa 1 chamada de API-Football por liga (a temporada atual) e zero
// crédito da The Odds API.
// Liga que falha mantém o fit anterior; o predict larga o DC sozinho quando ele fica
// velho (DC_MAX_FIT_AGE_MS). Sem a temporada atual nunca grava: um fit "fresco" feito
// só com temporadas passadas congelaria a forma no fim da temporada anterior.

const SEASONS_BACK = 3;
// Abaixo disso o ajuste é quase só o prior; não sobrescreve um fit bom com um ruim
// (ex.: só a temporada atual respondeu, no começo dela).
export const MIN_FIT_MATCHES = 100;
// Não começa liga nova depois disso: o cron e a server action têm 300s, e o throttle
// da API-Football (8/min) enfileira a 1ª rodada (4 chamadas por liga).
export const RUN_DEADLINE_MS = 240_000;
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
      reason:
        | "too_few_matches"
        | "all_seasons_failed"
        | "current_season_failed"
        // Temporada que o fit atual (ainda válido) tinha falhou agora: não troca
        // 3 anos de histórico por um ajuste mais magro.
        | "partial_fetch_kept_previous"
        | "invalid_fit"
        | "write_failed"
        // Prazo do run estourou antes desta liga; as temporadas já guardadas ficam.
        | "deadline"
        | "error";
      matchCount: number;
      failedSeasons: number[];
    };

/**
 * Falha que o cron deve acusar: a liga ficou sem ajuste novo por erro, não por falta
 * de dado ("poucos jogos"). Temporada passada que nunca respondeu não conta.
 */
export function isRefitFailure(r: LeagueRefitResult): boolean {
  return r.status === "skipped" && r.reason !== "too_few_matches";
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(
    JSON.stringify({ scope: "refit_team_ratings", event, ...fields })
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toSeasonResults(
  fixtures: readonly NormalizedFixture[]
): SeasonResult[] {
  const out: SeasonResult[] = [];
  for (const f of fixtures) {
    if (f.status !== "finished") continue;
    if (f.score.home === null || f.score.away === null) continue;
    out.push({
      kickoffMs: f.kickoffTimestampMs,
      home: f.homeTeam,
      away: f.awayTeam,
      homeGoals: f.score.home,
      awayGoals: f.score.away,
    });
  }
  return out;
}

// Dedup por (kickoff, mandante, visitante) — a chave composta das fixtures: a mesma
// partida não entra duas vezes se duas temporadas se sobrepõem no provider.
function toDcMatches(results: readonly SeasonResult[]): DcMatch[] {
  const byKey = new Map<string, DcMatch>();
  for (const r of results) {
    byKey.set(`${r.kickoffMs}:${r.home}:${r.away}`, {
      date: new Date(r.kickoffMs),
      home: r.home,
      away: r.away,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
    });
  }
  return [...byKey.values()];
}

async function readCachedSeasons(
  league: SupportedLeague,
  seasons: readonly number[]
): Promise<Map<number, SeasonResult[]>> {
  try {
    return await getCachedSeasonResults(league, seasons);
  } catch (err) {
    // Sem cache, busca tudo no provider: mais chamadas, mesmo resultado.
    logError("season_cache_read_failed", {
      league,
      message: errorMessage(err),
    });
    return new Map();
  }
}

/** Temporada atual sempre do provider; as encerradas do cache, ou do provider uma vez. */
async function loadSeasons(
  league: SupportedLeague,
  now: Date
): Promise<{
  results: SeasonResult[];
  okSeasons: number[];
  failedSeasons: number[];
  currentFailed: boolean;
}> {
  const current = currentSeason(league, now);
  const seasons = Array.from(
    { length: SEASONS_BACK + 1 },
    (_, i) => current - i
  );
  const cached = await readCachedSeasons(league, seasons.slice(1));
  const toFetch = seasons.filter((s) => !cached.has(s));

  const provider = getSportsDataProvider();
  const bySeason = new Map(cached);
  const failedSeasons: number[] = [];
  // Cada temporada é guardada assim que chega (não depois de todas): um timeout no
  // meio da 1ª rodada não perde o que já veio.
  await Promise.all(
    toFetch.map(async (season) => {
      let fixtures: NormalizedFixture[];
      try {
        fixtures = await provider.getFixturesBySeason(league, season);
      } catch (err) {
        failedSeasons.push(season);
        logError("season_fetch_failed", {
          league,
          season,
          message: errorMessage(err),
        });
        return;
      }
      const results = toSeasonResults(fixtures);
      bySeason.set(season, results);
      if (season === current || !isCompleteSeason(fixtures)) return;
      try {
        await saveSeasonResults(league, season, results, now);
      } catch (err) {
        logError("season_cache_write_failed", {
          league,
          season,
          message: errorMessage(err),
        });
      }
    })
  );
  failedSeasons.sort((a, b) => b - a);

  const okSeasons = seasons.filter((s) => bySeason.has(s));
  return {
    results: okSeasons.flatMap((s) => bySeason.get(s)!),
    okSeasons,
    failedSeasons,
    currentFailed: failedSeasons.includes(current),
  };
}

// Só guarda temporada que o provider devolveu inteira e terminada: lista vazia
// (resposta 200 sem jogos) ou jogo ainda agendado/adiado (calendário atípico, como a
// Champions 2019/20 terminando em agosto) fica fora do cache e é buscada de novo.
function isCompleteSeason(fixtures: readonly NormalizedFixture[]): boolean {
  return (
    fixtures.length > 0 &&
    fixtures.every((f) => f.status === "finished" || f.status === "cancelled")
  );
}

function isValidRating(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

// O fit atual ainda vale E foi feito com alguma temporada que agora falhou? Então
// trocar pioraria o ajuste. Temporada que nunca respondeu (plano do provider sem
// ela) não trava o refit: o fit atual também não a tinha.
async function freshFitHasMoreSeasons(
  league: SupportedLeague,
  failedSeasons: readonly number[],
  now: Date
): Promise<boolean> {
  try {
    const info = await getLeagueFitInfo(league);
    return (
      info !== null &&
      now.getTime() - info.fittedAt.getTime() <= DC_MAX_FIT_AGE_MS &&
      failedSeasons.some((s) => info.seasons.includes(s))
    );
  } catch {
    return false;
  }
}

async function refitLeague(
  league: SupportedLeague,
  now: Date
): Promise<LeagueRefitResult> {
  const { results, okSeasons, failedSeasons, currentFailed } =
    await loadSeasons(league, now);
  if (okSeasons.length === 0) {
    return {
      league,
      status: "skipped",
      reason: "all_seasons_failed",
      matchCount: 0,
      failedSeasons,
    };
  }
  if (currentFailed) {
    return {
      league,
      status: "skipped",
      reason: "current_season_failed",
      matchCount: 0,
      failedSeasons,
    };
  }

  const cutoffMs = now.getTime() - DC_DEFAULTS.maxAgeDays * 86_400_000;
  const matches = toDcMatches(results).filter((m) => {
    const t = m.date.getTime();
    return t < now.getTime() && t >= cutoffMs;
  });

  if (
    failedSeasons.length > 0 &&
    (await freshFitHasMoreSeasons(league, failedSeasons, now))
  ) {
    return {
      league,
      status: "skipped",
      reason: "partial_fetch_kept_previous",
      matchCount: matches.length,
      failedSeasons,
    };
  }

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

  // Parâmetro não finito vira matriz NaN no predict; nunca grava.
  if (
    !isValidRating(model.homeAdvantage) ||
    !Number.isFinite(model.rho) ||
    teams.some((t) => !isValidRating(t.attack) || !isValidRating(t.defence))
  ) {
    logError("invalid_fit", {
      league,
      homeAdvantage: model.homeAdvantage,
      rho: model.rho,
    });
    return {
      league,
      status: "skipped",
      reason: "invalid_fit",
      matchCount: matches.length,
      failedSeasons,
    };
  }

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
    logError("write_failed", { league, message: errorMessage(err) });
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
 * Refita todas as ligas ativas (ou `opts.leagues`). Liga a liga em série: o fit é de
 * milissegundos e o throttle do provider serializa as chamadas de qualquer jeito. A
 * 1ª rodada de uma liga busca as 4 temporadas; cada encerrada fica guardada assim que
 * chega, então um run que estoura o tempo não perde o que já veio. Passado
 * RUN_DEADLINE_MS, as ligas restantes saem como "deadline" (falha, acusa no cron).
 */
export async function refitTeamRatings(
  opts: { leagues?: readonly SupportedLeague[]; now?: Date } = {}
): Promise<LeagueRefitResult[]> {
  const now = opts.now ?? new Date();
  const startedMs = Date.now();
  const leagues = (opts.leagues ?? (await getActiveLeagues())).filter(
    (l) => !EXCLUDED.has(l)
  );
  const results: LeagueRefitResult[] = [];
  for (const league of leagues) {
    if (Date.now() - startedMs > RUN_DEADLINE_MS) {
      results.push({
        league,
        status: "skipped",
        reason: "deadline",
        matchCount: 0,
        failedSeasons: [],
      });
      continue;
    }
    try {
      results.push(await refitLeague(league, now));
    } catch (err) {
      // Uma liga que lança não derruba as outras.
      logError("league_failed", { league, message: errorMessage(err) });
      results.push({
        league,
        status: "skipped",
        reason: "error",
        matchCount: 0,
        failedSeasons: [],
      });
    }
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
