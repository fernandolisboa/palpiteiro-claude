import {
  formatCountdown,
  formatKickoffAbsolute,
  formatKickoffRelative,
  leagueToKey,
} from "@/lib/format";
// Bound compartilhado da janela "em andamento" — DEVE casar com o bound da query
// em app/jogos/page.tsx, senão pertinência-na-lista e elegibilidade-da-badge
// dessincronizam (jogo na lista mas isInProgress=false → cai no branch de odds =
// parece apostável).
import { IN_PROGRESS_WINDOW_MS } from "@/lib/view/date-range";
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
  // Fuso de exibição do usuário (#1). Undefined = fuso do runtime (legado/testes).
  timeZone?: string;
};

export function toMatchRowView({
  match,
  odds,
  matchResultOdds,
  hasPrediction,
  now = new Date(),
  timeZone,
}: ToMatchRowArgs): MatchRowView {
  const league = leagueToKey(match.league);
  // "Em andamento" derivado de kickoff+now+status (NÃO de um status DB novo, que
  // exigiria a chamada de API proibida): jogo que apitou (kickoff <= now), ainda
  // dentro da janela de 3h (upper-EXCLUSIVO: passou de kickoff+3h some da lista E
  // perde a badge — não fica pendurado pra sempre) e cujo status não é terminal.
  // Exclusão EXPLÍCITA de finished/cancelled/postponed (não denylist de `live`):
  // um adiado cujo kickoff original passou NÃO vira "em andamento".
  const nowMs = now.getTime();
  const kickoffMs = match.kickoffAt.getTime();
  const inProgress =
    kickoffMs <= nowMs &&
    nowMs < kickoffMs + IN_PROGRESS_WINDOW_MS &&
    match.status !== "finished" &&
    match.status !== "cancelled" &&
    match.status !== "postponed";
  return {
    id: match.id,
    home: teamToTeam(match.homeTeam, league),
    away: teamToTeam(match.awayTeam, league),
    league,
    kickoff: formatKickoffRelative(match.kickoffAt, now, timeZone),
    when: formatKickoffAbsolute(match.kickoffAt, now, timeZone),
    // Prioridade de display (#173): 1X2 quando há captura h2h, senão over/under,
    // senão sem odd. Única market-literal sancionada na view — roteamento de
    // FONTE (tabelas distintas), não dispatch de normalização. Um 3º mercado ao
    // vivo revisita esta ordem.
    odds: matchResultOdds
      ? toMatchRowResultOdds(matchResultOdds, "match_result")
      : toMatchRowOdds(odds),
    hasPrediction,
    status: match.status,
    isInProgress: inProgress,
    // Só expõe placar em jogos encerrados. Um provider pode carregar gols
    // parciais num `live`/em-andamento ou deixá-los preenchidos num
    // `postponed`/`cancelled`; só `finished` deve mostrar placar final — os
    // demais ficam null (a badge "ao vivo" é só indicador, sem placar fabricado).
    homeScore: match.status === "finished" ? match.homeScore : null,
    awayScore: match.status === "finished" ? match.awayScore : null,
    venue: match.venue,
    countdown: formatCountdown(match.kickoffAt, now, timeZone),
  };
}

export function toMatchHeroView(args: ToMatchRowArgs): MatchHeroView {
  return toMatchRowView(args);
}
