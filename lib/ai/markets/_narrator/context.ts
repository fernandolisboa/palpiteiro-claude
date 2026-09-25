import type { JudgmentAbsenceInput } from "@/lib/ai/judgments/state";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import type {
  NormalizedFixture,
  NormalizedH2H,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

import { describeAbsencePt } from "./labels";
import type { NarratorContext } from "./types";

// Monta o contexto do narrador a partir dos dados que o predict já buscou (mesma
// base do prompt de mercado). Desfalques vão por função, sem nome (ADR 0041, LGPD).

function sameTeam(a: string, b: string): boolean {
  return a === b || normalizeTeamName(a) === normalizeTeamName(b);
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

// "V 2-1 x Bahia (casa)" do ponto de vista de `team`. Jogo sem placar é pulado.
function formLine(team: string, f: NormalizedFixture): string | null {
  const { home, away } = f.score;
  if (home === null || away === null) return null;
  const isHome = sameTeam(f.homeTeam, team);
  const gf = isHome ? home : away;
  const ga = isHome ? away : home;
  const result = gf > ga ? "V" : gf === ga ? "E" : "D";
  const opponent = isHome ? f.awayTeam : f.homeTeam;
  return `${result} ${gf}-${ga} x ${opponent} (${isHome ? "casa" : "fora"})`;
}

export function buildNarratorContext(data: {
  league: SupportedLeague;
  kickoffAt: Date;
  venue?: string;
  homeTeam: string;
  awayTeam: string;
  standings: NormalizedStanding | undefined;
  homeForm: readonly NormalizedFixture[];
  awayForm: readonly NormalizedFixture[];
  h2h: readonly NormalizedH2H[];
  absencesAvailable: boolean;
  absences: {
    home: readonly JudgmentAbsenceInput[];
    away: readonly JudgmentAbsenceInput[];
  };
}): NarratorContext {
  const standings: NarratorContext["standings"] = [];
  for (const team of [data.homeTeam, data.awayTeam]) {
    const row = data.standings?.tables
      .flatMap((t) => t.teams)
      .find((r) => sameTeam(r.team, team));
    if (row) {
      standings.push({
        team,
        position: row.position,
        played: row.played,
        points: row.points,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
      });
    }
  }
  const form = (team: string, fixtures: readonly NormalizedFixture[]) =>
    [...fixtures]
      .sort((a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs)
      .map((f) => formLine(team, f))
      .filter((l): l is string => l !== null);

  return {
    leagueLabel: LEAGUE_LABEL[leagueToKey(data.league)],
    kickoffAt: data.kickoffAt.toISOString(),
    venue: data.venue,
    standings,
    form: {
      home: form(data.homeTeam, data.homeForm),
      away: form(data.awayTeam, data.awayForm),
    },
    h2h: data.h2h
      .filter((m) => m.score.home !== null && m.score.away !== null)
      .map(
        (m) =>
          `${isoDate(m.kickoffAt)}: ${m.homeTeam} ${m.score.home}-${m.score.away} ${m.awayTeam}`
      ),
    absences: {
      available: data.absencesAvailable,
      home: data.absences.home.map(describeAbsencePt),
      away: data.absences.away.map(describeAbsencePt),
    },
  };
}
