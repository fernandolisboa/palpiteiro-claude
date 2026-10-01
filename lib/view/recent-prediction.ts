import { formatEdge, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { findMarketPresentation } from "@/lib/view/markets/presentation";
import {
  marketContextLabel,
  recommendationLabel,
} from "@/lib/view/recommendation";
import { teamToTeam } from "@/lib/view/team";
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
  return {
    id: row.predictionId,
    matchId: row.matchId,
    // `.short` deriva sempre do canonical (league-inerte); o league vai junto só
    // pra manter a assinatura uniforme do seam — a tradução de `.name` é descartada.
    home: teamToTeam(row.homeTeam, league).short,
    away: teamToTeam(row.awayTeam, league).short,
    rec: recommendationLabel(
      row.recommendation,
      marketKey,
      row.selectionLabel,
    ),
    market: marketContextLabel(
      row.marketLabel ??
        findMarketPresentation(marketKey)?.marketLabel ??
        marketKey,
      row.marketParams,
    ),
    edge: formatEdge(row.edgePct),
    when: formatRecentWhen(row.createdAt, timeZone),
    league,
  };
}
