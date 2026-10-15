import { formatEdgePoints, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { displayMarketLabel, findDisplayPresentation } from "@/lib/view/markets/display";
import {
  marketContextLabel,
  recommendationKind,
  recommendationLabel,
} from "@/lib/view/recommendation";
import { teamPair } from "@/lib/view/team";
import type { RecentPredictionView } from "@/lib/view/types";

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// "DD mmm" no fuso do usuário (#1). Undefined = fuso do runtime (legado/testes).
function formatRecentWhen(date: Date, timeZone?: string): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return `${pick("day").toString().padStart(2, "0")} ${MONTH_ABBR_PT[pick("month") - 1]}`;
  }
  const day = date.getDate().toString().padStart(2, "0");
  return `${day} ${MONTH_ABBR_PT[date.getMonth()]}`;
}

type RecentInput = {
  predictionId: string;
  matchId: string;
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  // = key da seleção escolhida (qualquer mercado) ou "pass".
  recommendation: string;
  // null = row sem marketId (histórica pré-backfill) → over/under, como no
  // dashboard (marketEnumToKey).
  marketKey: string | null;
  marketLabel: string | null;
  marketParams: { line: number } | null;
  selectionLabel: string | null;
  edgePct: string | number | null;
  createdAt: Date;
};

export function toRecentPredictionView(
  row: RecentInput,
  timeZone?: string,
): RecentPredictionView {
  const league = leagueToKey(row.league);
  const marketKey = row.marketKey ?? "over_under";
  // Siglas do par (#578): `.short` deriva do canonical; o teamPair desempata
  // quando as duas siglas do jogo coincidem.
  const pair = teamPair(row.homeTeam, row.awayTeam, league);
  const home = pair.home.short;
  const away = pair.away.short;
  return {
    id: row.predictionId,
    matchId: row.matchId,
    home,
    away,
    rec: recommendationLabel(
      row.recommendation,
      marketKey,
      row.selectionLabel,
      { home, away },
      row.marketParams?.line ?? null,
    ),
    recKind: recommendationKind(row.recommendation),
    market: marketContextLabel(
      row.marketLabel
        ? displayMarketLabel(marketKey, row.marketLabel)
        : (findDisplayPresentation(marketKey)?.marketLabel ?? marketKey),
      row.marketParams,
      row.recommendation,
    ),
    edge: formatEdgePoints(row.edgePct),
    when: formatRecentWhen(row.createdAt, timeZone),
    league,
  };
}
