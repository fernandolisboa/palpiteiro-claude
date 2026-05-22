import { formatEdge, leagueToKey } from "@/lib/format";
import { teamToTeam } from "@/lib/view/team";
import type {
  Recommendation,
  RecentPredictionView,
} from "@/lib/view/types";

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function formatRecentWhen(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  return `${day} ${MONTH_ABBR_PT[date.getMonth()]}`;
}

type RecentInput = {
  predictionId: string;
  matchId: string;
  league: "brasileirao_a" | "champions_league";
  homeTeam: string;
  awayTeam: string;
  recommendation: "over" | "under" | "pass";
  edgePct: string | number | null;
  createdAt: Date;
};

const REC_MAP: Record<RecentInput["recommendation"], Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

export function toRecentPredictionView(row: RecentInput): RecentPredictionView {
  return {
    id: row.predictionId,
    matchId: row.matchId,
    home: teamToTeam(row.homeTeam).short,
    away: teamToTeam(row.awayTeam).short,
    rec: REC_MAP[row.recommendation],
    edge: formatEdge(row.edgePct),
    when: formatRecentWhen(row.createdAt),
    league: leagueToKey(row.league),
  };
}
