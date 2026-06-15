import {
  formatCountdown,
  formatKickoffAbsolute,
  formatKickoffRelative,
  leagueToKey,
} from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { teamToTeam } from "@/lib/view/team";
import {
  toMatchRowOdds,
  toMatchRowResultOdds,
  type OddsSnapshotInput,
} from "@/lib/view/odds";
import type {
  MatchHeroView,
  MatchRowView,
  MatchStatus,
} from "@/lib/view/types";

export type MatchInput = {
  id: string;
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  venue?: string;
};

export type ToMatchRowArgs = {
  match: MatchInput;
  odds: OddsSnapshotInput | null;
  // Captura N-vias 1X2 (#173 PR-2): quando presente, o chip mostra 1X2
  // (prioridade), senão cai pro over/under. OPCIONAL — só a home passa; o hero
  // do detalhe e os call sites de teste compilam sem mudar (default undefined).
  matchResultOdds?: { selections: { key: string; odd: string }[] } | null;
  hasPrediction: boolean;
  now?: Date;
};

export function toMatchRowView({
  match,
  odds,
  matchResultOdds,
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
    // Prioridade de display (#173): 1X2 quando há captura h2h, senão over/under,
    // senão sem odd. Única market-literal sancionada na view — roteamento de
    // FONTE (tabelas distintas), não dispatch de normalização. Um 3º mercado ao
    // vivo revisita esta ordem.
    odds: matchResultOdds
      ? toMatchRowResultOdds(matchResultOdds, "match_result")
      : toMatchRowOdds(odds),
    hasPrediction,
    status: match.status,
    // Só expõe placar em jogos encerrados. Um provider pode carregar gols
    // parciais num `live` ou deixá-los preenchidos num `postponed`/`cancelled`;
    // só `finished` deve mostrar placar final — os demais ficam null.
    homeScore: match.status === "finished" ? match.homeScore : null,
    awayScore: match.status === "finished" ? match.awayScore : null,
    venue: match.venue,
    countdown: formatCountdown(match.kickoffAt, now),
  };
}

export function toMatchHeroView(args: ToMatchRowArgs): MatchHeroView {
  return toMatchRowView(args);
}
