import {
  dayKeyOf,
  formatCountdown,
  formatDayHeading,
  formatKickoffAbsolute,
  formatKickoffRelative,
  formatRelativeAgoLabel,
  formatStartsIn,
  formatTimeOfDay,
  leagueToKey,
} from "@/lib/format";
// Bound compartilhado da janela "em andamento" — DEVE casar com o bound da query
// em app/(app)/jogos/page.tsx, senão pertinência-na-lista e elegibilidade-da-badge
// dessincronizam (jogo na lista mas isInProgress=false → cai no branch de odds =
// parece apostável).
import { IN_PROGRESS_WINDOW_MS } from "@/lib/view/date-range";
import { matchUnavailableReason } from "@/lib/view/match-availability";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { teamPair } from "@/lib/view/team";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_MAX_AGE_MS } from "@/lib/model-base/version";
import { toMatchModelLineView } from "@/lib/view/match-model";
import {
  toMatchRowOdds,
  toMatchRowResultOdds,
  type OddsSnapshotInput,
} from "@/lib/view/odds";
import type {
  MatchHeroView,
  MatchListRowView,
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
  // Última gravação da linha (matches.updatedAt, regravado a cada sincronização):
  // data do placar parcial de um jogo `live` (#574). Opcional — sem ela a legenda
  // fica só "parcial".
  updatedAt?: Date;
  // Escudo de cada time (#578, matches.*_team_crest_url). Opcional: sem ele a UI
  // mostra as iniciais.
  homeTeamCrestUrl?: string | null;
  awayTeamCrestUrl?: string | null;
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
  // Base do modelo do jogo (#555): vira a linha "Modelo: …" do /jogos, só em jogo
  // analisável. Opcional — o hero e os call sites antigos não passam.
  modelSnapshot?: MatchModelSnapshot | null;
};

export function toMatchRowView({
  match,
  odds,
  matchResultOdds,
  hasPrediction,
  now = new Date(),
  timeZone,
  modelSnapshot,
}: ToMatchRowArgs): MatchRowView {
  const league = leagueToKey(match.league);
  // "Em andamento" derivado de kickoff+now+status (NÃO de um status DB novo, que
  // exigiria a chamada de API proibida): jogo que apitou (kickoff <= now), ainda
  // dentro da janela de 3h (upper-EXCLUSIVO: passou de kickoff+3h some da lista E
  // perde a badge — não fica pendurado pra sempre) e cujo status não é terminal.
  // Exclusão EXPLÍCITA de finished/cancelled/postponed (não denylist de `live`):
  // um adiado cujo kickoff original passou NÃO vira "em andamento".
  const { home, away } = teamPair(match.homeTeam, match.awayTeam, league, {
    home: match.homeTeamCrestUrl,
    away: match.awayTeamCrestUrl,
  });
  // Sigla de 3 letras nos rótulos de 1X2 (coluna estreita da lista): "PAL 2,67 ·
  // Empate 2,87 · FLA 3,06" e "Modelo: PAL 42%" (#574 linha 4b).
  const shortTeams = { home: home.short, away: away.short };
  const nowMs = now.getTime();
  const kickoffMs = match.kickoffAt.getTime();
  const analyzable =
    matchUnavailableReason(match.status, match.kickoffAt, now) === null;
  const inProgress =
    kickoffMs <= nowMs &&
    nowMs < kickoffMs + IN_PROGRESS_WINDOW_MS &&
    match.status !== "finished" &&
    match.status !== "cancelled" &&
    match.status !== "postponed";
  return {
    id: match.id,
    home,
    away,
    league,
    kickoff: formatKickoffRelative(match.kickoffAt, now, timeZone),
    when: formatKickoffAbsolute(match.kickoffAt, now, timeZone),
    // Prioridade de display (#173): 1X2 quando há captura h2h, senão over/under,
    // senão sem odd. Única market-literal sancionada na view — roteamento de
    // FONTE (tabelas distintas), não dispatch de normalização. Um 3º mercado ao
    // vivo revisita esta ordem.
    odds: matchResultOdds
      ? toMatchRowResultOdds(matchResultOdds, "match_result", shortTeams)
      : toMatchRowOdds(odds),
    hasPrediction,
    status: match.status,
    isInProgress: inProgress,
    // Mesmo gate da página do jogo e das actions (status agendado + kickoff no futuro).
    analyzable,
    // Só expõe placar em jogos encerrados. Um provider pode carregar gols
    // parciais num `live`/em-andamento ou deixá-los preenchidos num
    // `postponed`/`cancelled`; só `finished` deve mostrar placar final — os
    // demais ficam null (a badge "ao vivo" é só indicador, sem placar fabricado).
    homeScore: match.status === "finished" ? match.homeScore : null,
    awayScore: match.status === "finished" ? match.awayScore : null,
    // Placar parcial só em `live` com os dois gols (#574): chave ausente no resto,
    // como `model`, pra não mexer nos goldens.
    ...(match.status === "live" &&
    match.homeScore !== null &&
    match.awayScore !== null
      ? {
          liveScore: {
            home: match.homeScore,
            away: match.awayScore,
            caption: match.updatedAt
              ? `parcial · atualizado ${formatRelativeAgoLabel(match.updatedAt, now)}`
              : "parcial",
          },
        }
      : {}),
    venue: match.venue,
    countdown: formatCountdown(match.kickoffAt, now, timeZone),
    // Chave ausente (não `model: undefined`) sem base ou com base velha (mesmo limite
    // do seam do cupom): goldens do MatchRow intactos.
    ...(analyzable &&
    modelSnapshot &&
    nowMs - modelSnapshot.checkedAt.getTime() <= MATCH_MODEL_MAX_AGE_MS
      ? { model: toMatchModelLineView(modelSnapshot, shortTeams) }
      : {}),
  };
}

/**
 * Linha da lista de jogos agrupada por dia (#577): a mesma `MatchRowView` mais o dia
 * e a hora no fuso do usuário. `now` e `timeZone` obrigatórios: sem fuso o grupo
 * cairia no dia do runtime (UTC na Vercel, o bug do #409). A contagem "em 2h 15min"
 * só vale pra jogo agendado: um adiado com o horário antigo nas próximas 3h não
 * ganha contagem.
 */
export function toMatchListRowView(
  args: ToMatchRowArgs & { now: Date; timeZone: string },
): MatchListRowView {
  const row = toMatchRowView(args);
  const { kickoffAt, status } = args.match;
  const startsIn =
    status === "scheduled" ? formatStartsIn(kickoffAt, args.now) : undefined;
  return {
    ...row,
    day: {
      key: dayKeyOf(kickoffAt, args.timeZone),
      label: formatDayHeading(kickoffAt, args.now, args.timeZone),
    },
    time: formatTimeOfDay(kickoffAt, args.timeZone),
    ...(startsIn ? { startsIn } : {}),
  };
}

// Firewall do ADR 0030: o hero nunca carrega a leitura do modelo, mesmo que o caller
// passe a base (o tipo MatchHeroView também não tem o campo).
export function toMatchHeroView(args: ToMatchRowArgs): MatchHeroView {
  const { model: _model, ...hero } = toMatchRowView(args);
  return hero;
}
