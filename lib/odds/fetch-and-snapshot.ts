import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import { getOddsForSport } from "@/lib/providers/odds-api";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";
import { pickBestTotalsBookmaker } from "@/lib/odds/select-bookmaker";
import {
  getLatestOddsSnapshot,
  insertOddsSnapshotsBatch,
  type DbOddsSnapshot,
} from "@/lib/db/queries/odds-snapshots";
import { getMatchesInLeagueWindow, type DbMatch } from "@/lib/db/queries/matches";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

const KICKOFF_PAIRING_WINDOW_MS = 6 * 60 * 60 * 1000;

function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function findEventForMatch(
  events: OddsApiEventOdds[],
  match: DbMatch,
): OddsApiEventOdds | undefined {
  const kickoffMs = match.kickoffAt.getTime();
  return events.find((event) => {
    const ts = Date.parse(event.commence_time);
    if (
      !Number.isFinite(ts) ||
      Math.abs(ts - kickoffMs) > KICKOFF_PAIRING_WINDOW_MS
    ) {
      return false;
    }
    return (
      teamsMatch(event.home_team, match.homeTeam) &&
      teamsMatch(event.away_team, match.awayTeam)
    );
  });
}

function isFresh(snapshot: DbOddsSnapshot | null, now: number): boolean {
  if (!snapshot) return false;
  return now - snapshot.capturedAt.getTime() < ODDS_SNAPSHOT_FRESHNESS_MS;
}

/**
 * Garante uma snapshot fresca (< 30min) para o `match` requisitado.
 *
 * Estratégia de quota:
 *   - The Odds API free tier = 500 req/mês. Não dá pra fazer fetch por match.
 *   - getOddsForSport(sportKey) retorna TODOS os eventos da liga em UMA call.
 *   - Quando o snapshot do match alvo está stale (ou inexistente), buscamos a
 *     liga inteira E persistimos snapshots pra TODOS os matches conhecidos da
 *     janela — não só o requisitado. Próximos clicks na liga reusam dentro
 *     do TTL externo de 30min sem consumir quota.
 *   - odds-api.ts já tem cache interno (5-15min adaptativo). Este TTL de
 *     30min é a camada externa "vale considerar re-fetch?".
 *
 * Retorna a snapshot mais recente do match após a operação (ou null se a liga
 * não tem o evento, ou se nenhum bookmaker oferece totals 2.5).
 */
export async function ensureOddsSnapshotsFresh(
  match: DbMatch,
  now: Date = new Date(),
): Promise<DbOddsSnapshot | null> {
  const existing = await getLatestOddsSnapshot(match.id);
  if (isFresh(existing, now.getTime())) return existing;

  // 1 call = liga inteira. Persiste snapshots em batch.
  const sportKey = leagueToSportKey(match.league);
  let events: OddsApiEventOdds[];
  try {
    events = await getOddsForSport(sportKey, {
      markets: ["totals"],
      regions: ["eu"],
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "fetch-and-snapshot",
        league: match.league,
        matchId: match.id,
        error: "getOddsForSport_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return existing; // melhor que crashar a UI; lista/detalhe degradam.
  }

  const knownMatches = await getMatchesInLeagueWindow({
    league: match.league,
    windowHours: 7 * 24,
  });

  const rowsToInsert: Array<{
    matchId: string;
    bookmaker: string;
    overOdd: number;
    underOdd: number;
    overroundPct: number;
  }> = [];

  for (const m of knownMatches) {
    const event = findEventForMatch(events, m);
    if (!event) continue;
    const bundle = pickBestTotalsBookmaker(event);
    if (!bundle) continue;
    const { overround } = computeImpliedProbabilities(
      bundle.overOdd,
      bundle.underOdd,
    );
    rowsToInsert.push({
      matchId: m.id,
      bookmaker: bundle.bookmakerTitle,
      overOdd: bundle.overOdd,
      underOdd: bundle.underOdd,
      overroundPct: overround * 100,
    });
  }

  if (rowsToInsert.length > 0) {
    await insertOddsSnapshotsBatch(rowsToInsert);
  }

  return getLatestOddsSnapshot(match.id);
}
