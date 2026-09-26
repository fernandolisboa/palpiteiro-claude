import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

import { teamRatingFits, teamRatings } from "@/db/schema";
import { db } from "@/lib/db";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
  DC_MIN_TEAM_MATCHES,
  type DcFitSnapshot,
  type DcTeamRating,
} from "@/lib/quant/match-model";

// Boundary única de team_rating_fits + team_ratings (ADR 0051).

export type LeagueRatingsWrite = {
  league: SupportedLeague;
  homeAdvantage: number;
  rho: number;
  matchCount: number;
  seasons: number[];
  fittedAt: Date;
  teams: { team: string; attack: number; defence: number; matches: number }[];
};

/**
 * Troca o fit da liga inteiro: apaga os ratings antigos, grava os novos e o fit.
 * db.batch = uma transação no neon-http, então o predict nunca lê uma liga pela
 * metade (fit novo com times velhos, ou time sumido).
 */
export async function replaceLeagueRatings(
  w: LeagueRatingsWrite
): Promise<void> {
  const fit = {
    homeAdvantage: w.homeAdvantage,
    rho: w.rho,
    matchCount: w.matchCount,
    seasons: w.seasons,
    fittedAt: w.fittedAt,
  };
  const deleteOld = db
    .delete(teamRatings)
    .where(eq(teamRatings.league, w.league));
  const upsertFit = db
    .insert(teamRatingFits)
    .values({ league: w.league, ...fit })
    .onConflictDoUpdate({ target: teamRatingFits.league, set: fit });
  if (w.teams.length === 0) {
    await db.batch([deleteOld, upsertFit]);
    return;
  }
  await db.batch([
    deleteOld,
    db
      .insert(teamRatings)
      .values(w.teams.map((t) => ({ league: w.league, ...t }))),
    upsertFit,
  ]);
}

export type MatchRatings = {
  fit: DcFitSnapshot | null;
  home: DcTeamRating | null;
  away: DcTeamRating | null;
};

/** Fit da liga + ratings dos dois times (null onde não há row). */
export async function getMatchRatings(
  league: SupportedLeague,
  homeTeam: string,
  awayTeam: string
): Promise<MatchRatings> {
  const [fits, teams] = await Promise.all([
    db
      .select({
        homeAdvantage: teamRatingFits.homeAdvantage,
        rho: teamRatingFits.rho,
        fittedAt: teamRatingFits.fittedAt,
      })
      .from(teamRatingFits)
      .where(eq(teamRatingFits.league, league))
      .limit(1),
    db
      .select({
        team: teamRatings.team,
        attack: teamRatings.attack,
        defence: teamRatings.defence,
        matches: teamRatings.matches,
      })
      .from(teamRatings)
      .where(
        and(
          eq(teamRatings.league, league),
          inArray(teamRatings.team, [homeTeam, awayTeam])
        )
      ),
  ]);
  const byTeam = new Map(teams.map((t) => [t.team, t]));
  const rating = (team: string): DcTeamRating | null => {
    const r = byTeam.get(team);
    return r
      ? { attack: r.attack, defence: r.defence, matches: r.matches }
      : null;
  };
  return {
    fit: fits[0] ?? null,
    home: rating(homeTeam),
    away: rating(awayTeam),
  };
}

export type LeagueFitSummary = {
  league: SupportedLeague;
  homeAdvantage: number;
  rho: number;
  matchCount: number;
  seasons: number[];
  fittedAt: Date;
  teamCount: number;
  // Times com jogos suficientes na janela pra usar o DC (o resto cai no heurístico).
  usableTeamCount: number;
};

/** Fits gravados + contagem de times, pro painel do /admin/settings. */
export async function listLeagueFits(): Promise<LeagueFitSummary[]> {
  const [fits, counts] = await Promise.all([
    db.select().from(teamRatingFits).orderBy(asc(teamRatingFits.league)),
    db
      .select({
        league: teamRatings.league,
        teamCount: sql<number>`count(*)::int`,
        usableTeamCount: sql<number>`count(*) filter (where ${gte(
          teamRatings.matches,
          DC_MIN_TEAM_MATCHES
        )})::int`,
      })
      .from(teamRatings)
      .groupBy(teamRatings.league),
  ]);
  const byLeague = new Map(counts.map((c) => [c.league, c]));
  return fits.map((f) => ({
    ...f,
    teamCount: byLeague.get(f.league)?.teamCount ?? 0,
    usableTeamCount: byLeague.get(f.league)?.usableTeamCount ?? 0,
  }));
}
