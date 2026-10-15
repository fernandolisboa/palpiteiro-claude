import { formatEdge, formatWeekdayDate, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { displayMarketLabel, findDisplayPresentation } from "@/lib/view/markets/display";
import { marketContextLabel, recommendationLabel } from "@/lib/view/recommendation";
import { teamPair } from "@/lib/view/team";
import type { RecentMatchBetView, RecentMatchView } from "@/lib/view/types";

/** Apostas visíveis por cartão; as demais viram "+N". */
export const RECENT_VISIBLE_BETS = 2;

export type RecentPredictionInput = {
  predictionId: string;
  matchId: string;
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
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

function edgeValue(edgePct: string | number | null): number {
  const n = edgePct === null ? Number.NaN : Number(edgePct);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

/**
 * "Suas predições recentes", um cartão por jogo (ADR 0058). Agrupa as predições por
 * jogo, mantém a mais recente de cada mercado (a mesma chave da dedup dos KPIs,
 * `keepLatestPerMatch`: `marketKey`, sem a linha) e ordena os jogos pela análise mais
 * recente. No cartão: as apostas antes (maior vantagem primeiro), no máximo
 * `RECENT_VISIBLE_BETS` visíveis, e a contagem dos mercados sem aposta. Datas no fuso
 * do usuário.
 */
export function toRecentMatchViews(
  rows: readonly RecentPredictionInput[],
  now: Date,
  timeZone: string,
): RecentMatchView[] {
  const byMatch = new Map<string, Map<string, RecentPredictionInput>>();
  for (const row of rows) {
    const marketKey = row.marketKey ?? "over_under";
    const markets = byMatch.get(row.matchId) ?? new Map<string, RecentPredictionInput>();
    const current = markets.get(marketKey);
    if (!current || row.createdAt > current.createdAt) markets.set(marketKey, row);
    byMatch.set(row.matchId, markets);
  }

  const lastAnalysis = (latest: RecentPredictionInput[]) =>
    Math.max(...latest.map((r) => r.createdAt.getTime()));

  return [...byMatch.values()]
    .map((markets) => [...markets.values()])
    .sort((a, b) => lastAnalysis(b) - lastAnalysis(a))
    .map((latest) => {
      const first = latest[0];
      const league = leagueToKey(first.league);
      // Siglas do par (#578): o teamPair desempata quando as duas coincidem.
      const pair = teamPair(first.homeTeam, first.awayTeam, league);
      const teams = { home: pair.home.short, away: pair.away.short };
      const bets: RecentMatchBetView[] = latest
        .filter((r) => r.recommendation !== "pass")
        .sort(
          (a, b) =>
            edgeValue(b.edgePct) - edgeValue(a.edgePct) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .map((r) => {
          const marketKey = r.marketKey ?? "over_under";
          return {
            market: marketContextLabel(
              r.marketLabel
                ? displayMarketLabel(marketKey, r.marketLabel)
                : (findDisplayPresentation(marketKey)?.marketLabel ?? marketKey),
              r.marketParams,
              r.recommendation,
            ),
            rec: recommendationLabel(
              r.recommendation,
              marketKey,
              r.selectionLabel,
              teams,
              r.marketParams?.line ?? null,
            ),
            edge: formatEdge(r.edgePct),
          };
        });
      return {
        matchId: first.matchId,
        league,
        home: teams.home,
        away: teams.away,
        when: formatWeekdayDate(first.kickoffAt, now, timeZone),
        bets: bets.slice(0, RECENT_VISIBLE_BETS),
        moreBets: Math.max(0, bets.length - RECENT_VISIBLE_BETS),
        passCount: latest.length - bets.length,
      };
    });
}
