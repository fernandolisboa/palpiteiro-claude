import {
  isLiveStateShowable,
  isPastInPlayWindow,
  liveStateAgeMs,
} from "@/lib/live/freshness";
import {
  classifyStatusShort,
  isTerminalStatusShort,
  type LiveStateInput,
} from "@/lib/live/phase";
import type { LiveStamp } from "@/lib/live/stamp";

// Placar ao vivo de tela (#580, PLAN-580 §13), a partir do estado lido em
// `match_live_states` (o InPlayState da página ou a row das listas). PURO: a idade é
// medida no `now` do request. Até IN_PLAY_SHOW_MAX_AGE_MS (10 min) o placar aparece com
// "atualizado há X"; depois, null (a tela cai no placar do sync ou em "placar ao vivo
// indisponível"). Nunca odd, modelo ou edge: o cabeçalho é firewall (ADR 0030).

/** O mínimo do estado que a tela usa (o InPlayState satisfaz). */
export type LiveScoreInput = LiveStateInput & {
  statusShort: string;
  fetchedAt: Date;
  minuteLabel: string | null;
  score: { home: number; away: number } | null;
  red: { home: number; away: number } | null;
  // Placar da disputa de pênaltis; ausente/null fora dela.
  penalties?: { home: number; away: number } | null;
};

export type LiveScoreView = {
  home: number;
  away: number;
  // "63' · atualizado há 20 s", "intervalo · atualizado há 2 min".
  caption: string;
  // Marca o placar vindo do estado ao vivo (não do sync, que é "parcial").
  live: true;
  // Expulsões por time; null sem dado ou sem nenhuma.
  red: { home: number; away: number } | null;
  // O provider já deu o fim (o sync ainda não virou o jogo): sem o selo "ao vivo".
  ended: boolean;
};

/** "há 20 s" abaixo de 1 min, "há 3 min" depois (a tela só mostra até 10 min). */
export function formatLiveAge(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 60) return `há ${s} s`;
  return `há ${Math.floor(s / 60)} min`;
}

/**
 * Rótulo do momento do jogo: o minuto ("63'", "45+2'"), "intervalo", "prorrogação",
 * "pênaltis", "jogo interrompido", "fim de jogo". Atraso (NS/TBD depois do horário):
 * "aguardando o apito". Adiado, cancelado ou código desconhecido: null (não mostra).
 * Com o placar da disputa: "pênaltis 2–3" durante e "fim de jogo · pênaltis 2–3" no fim.
 */
export function liveMomentLabel(
  state: Pick<LiveScoreInput, "statusShort" | "minuteLabel" | "penalties">
): string | null {
  const pens = state.penalties
    ? `pênaltis ${state.penalties.home}–${state.penalties.away}`
    : null;
  switch (classifyStatusShort(state.statusShort)) {
    case "pre_match":
      return "aguardando o apito";
    case "in_play":
      return state.minuteLabel ?? "em andamento";
    case "half_time":
      return "intervalo";
    case "extra_time":
      return state.statusShort === "P" ? (pens ?? "pênaltis") : "prorrogação";
    case "interrupted":
      return "jogo interrompido";
    case "finished":
      return state.statusShort === "PEN" && pens
        ? `fim de jogo · ${pens}`
        : "fim de jogo";
    default:
      return null;
  }
}

/**
 * Placar ao vivo para o cabeçalho e as listas; null quando velho demais ou sem placar.
 * O fim dado pelo provider (FT/AET/PEN…) não envelhece: a row terminal nunca é buscada
 * de novo, então vale sem o corte de 10 min e sem "atualizado há X" (senão, até o sync
 * virar o jogo, a tela voltava ao "AO VIVO" com o parcial do sync).
 */
export function toLiveScoreView(
  state: LiveScoreInput,
  now: Date
): LiveScoreView | null {
  const ended = classifyStatusShort(state.statusShort) === "finished";
  if (!ended && !isLiveStateShowable(state.fetchedAt, now)) return null;
  if (state.score === null) return null;
  const moment = liveMomentLabel(state);
  if (moment === null) return null;
  const age = liveStateAgeMs(state.fetchedAt, now) ?? 0;
  const red =
    state.red !== null && (state.red.home > 0 || state.red.away > 0)
      ? { home: state.red.home, away: state.red.away }
      : null;
  return {
    home: state.score.home,
    away: state.score.away,
    caption: ended ? moment : `${moment} · atualizado ${formatLiveAge(age)}`,
    live: true,
    red,
    ended,
  };
}

export type HeroLiveFollow = {
  // "placar ao vivo indisponível" quando não há placar ao vivo para mostrar; null com ele.
  note: string | null;
};

/**
 * O cabeçalho acompanha o jogo ("Atualizar placar", refresh ao voltar pra aba e, sem
 * placar, "placar ao vivo indisponível")? Só com a flag ligada, depois do apito, com o
 * banco ainda sem fim e DENTRO da janela de busca (kickoff + 4h): depois dela nada é
 * buscado, e o botão e o "indisponível" nunca se resolveriam (volta o "já começou"). Some
 * quando o provider já deu o fim.
 */
export function heroLiveFollow(input: {
  liveMode: boolean;
  match: { status: string; kickoffAt: Date };
  state: Pick<LiveScoreInput, "statusShort"> | null;
  liveScoreShown: boolean;
  now: Date;
}): HeroLiveFollow | null {
  const { liveMode, match, state, now } = input;
  if (!liveMode) return null;
  if (match.status !== "scheduled" && match.status !== "live") return null;
  if (match.kickoffAt.getTime() > now.getTime()) return null;
  if (isPastInPlayWindow(match.kickoffAt, now)) return null;
  if (state && isTerminalStatusShort(state.statusShort)) return null;
  return { note: input.liveScoreShown ? null : "placar ao vivo indisponível" };
}

/**
 * Selo de um registro ao vivo (#580): "ao vivo · 63' · 1–0", o momento CONGELADO no
 * carimbo (nunca o estado de agora). Sem minuto ou placar no carimbo, a parte some.
 */
export function liveStampLabel(stamp: LiveStamp): string {
  const moment =
    stamp.status === null
      ? stamp.minuteLabel
      : liveMomentLabel({ statusShort: stamp.status, minuteLabel: stamp.minuteLabel });
  const parts = ["ao vivo"];
  if (moment) parts.push(moment);
  if (stamp.score) parts.push(`${stamp.score.home}–${stamp.score.away}`);
  return parts.join(" · ");
}
