import { isLiveStateShowable, liveStateAgeMs } from "@/lib/live/freshness";
import { classifyStatusShort, type LiveStateInput } from "@/lib/live/phase";

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
 */
export function liveMomentLabel(
  state: Pick<LiveScoreInput, "statusShort" | "minuteLabel">
): string | null {
  switch (classifyStatusShort(state.statusShort)) {
    case "pre_match":
      return "aguardando o apito";
    case "in_play":
      return state.minuteLabel ?? "em andamento";
    case "half_time":
      return "intervalo";
    case "extra_time":
      return state.statusShort === "P" ? "pênaltis" : "prorrogação";
    case "interrupted":
      return "jogo interrompido";
    case "finished":
      return "fim de jogo";
    default:
      return null;
  }
}

/** Placar ao vivo para o cabeçalho e as listas; null quando velho demais ou sem placar. */
export function toLiveScoreView(
  state: LiveScoreInput,
  now: Date
): LiveScoreView | null {
  if (!isLiveStateShowable(state.fetchedAt, now)) return null;
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
    caption: `${moment} · atualizado ${formatLiveAge(age)}`,
    live: true,
    red,
    ended: classifyStatusShort(state.statusShort) === "finished",
  };
}
