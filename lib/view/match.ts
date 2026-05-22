import {
  formatCountdown,
  formatKickoffAbsolute,
  formatKickoffRelative,
  leagueToKey,
} from "@/lib/format";
import { teamToTeam } from "@/lib/view/team";
import { toMatchRowOdds, type OddsSnapshotInput } from "@/lib/view/odds";
import type { MatchHeroView, MatchRowView } from "@/lib/view/types";

export type MatchInput = {
  id: string;
  league: "brasileirao_a" | "champions_league";
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  venue?: string;
};

export type ToMatchRowArgs = {
  match: MatchInput;
  odds: OddsSnapshotInput | null;
  hasPrediction: boolean;
  now?: Date;
};

export function toMatchRowView({
  match,
  odds,
  hasPrediction,
  now = new Date(),
}: ToMatchRowArgs): MatchRowView {
  return {
    id: match.id,
    home: teamToTeam(match.homeTeam),
    away: teamToTeam(match.awayTeam),
    league: leagueToKey(match.league),
    kickoff: formatKickoffRelative(match.kickoffAt, now),
    when: formatKickoffAbsolute(match.kickoffAt, now),
    odds: toMatchRowOdds(odds),
    hasPrediction,
    venue: match.venue,
    countdown: formatCountdown(match.kickoffAt, now),
  };
}

export function toMatchHeroView(args: ToMatchRowArgs): MatchHeroView {
  return toMatchRowView(args);
}
