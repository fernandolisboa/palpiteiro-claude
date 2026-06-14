import { formatEdge, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
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
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  // = key da seleção escolhida (multi-mercado, #173) ou "pass". REC_MAP é total.
  recommendation:
    | "over"
    | "under"
    | "pass"
    | "home"
    | "draw"
    | "away"
    | "yes"
    | "no";
  edgePct: string | number | null;
  createdAt: Date;
};

// Tokens pinados do over/under/pass (paridade byte-idêntica). O feed recente NÃO
// junta `markets`, então não há marketKey aqui pra derivar o selectionLabel da
// apresentação (#173, PR-1 escopo "fallback mínimo"): seleções de mercado novo
// (1X2) caem num token neutro em MAIÚSCULAS (ex.: "HOME") — célula sã, não quebrada.
// O display 1X2 polido (Casa/Empate/Fora) é PR-2, quando a query passar a juntar markets.
const REC_TOKEN: Record<string, Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

function recToken(recommendation: RecentInput["recommendation"]): Recommendation {
  return recommendation in REC_TOKEN
    ? REC_TOKEN[recommendation]
    : recommendation.toUpperCase();
}

export function toRecentPredictionView(row: RecentInput): RecentPredictionView {
  return {
    id: row.predictionId,
    matchId: row.matchId,
    home: teamToTeam(row.homeTeam).short,
    away: teamToTeam(row.awayTeam).short,
    rec: recToken(row.recommendation),
    edge: formatEdge(row.edgePct),
    when: formatRecentWhen(row.createdAt),
    league: leagueToKey(row.league),
  };
}
