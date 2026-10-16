import { IN_PLAY_SHOW_MAX_AGE_MS } from "@/lib/live/freshness";
import { classifyStatusShort } from "@/lib/live/phase";
import { readLiveStamp, type LiveStamp } from "@/lib/live/stamp";

// Leituras ao vivo (#594, PLAN-580 §8.2). Puro: sem I/O.

// Página aberta antes do apito, pedido feito depois dele: a tela de pré-jogo não mostra
// a leitura ao vivo (oferece o "Contexto extra", lê o modelo de pré-jogo). Mesmo padrão
// do registro de apostas (LIVE_STALE_GRID_COPY): atualizar a página.
export const LIVE_STALE_PAGE_COPY =
  "O jogo começou. Atualize a página para a leitura ao vivo.";

/** O form manda `pageLive=1` só quando a página foi montada com o jogo rolando. */
export function livePageRefusal(formData: { get(name: string): unknown }): string | null {
  return formData.get("pageLive") === "1" ? null : LIVE_STALE_PAGE_COPY;
}

/**
 * O momento do jogo numa frase: "aos 63'", "aos 45+2'", "no intervalo". Sem minuto,
 * "com o jogo em andamento". A mesma frase vai pros prompts ao vivo e pros selos.
 */
export function liveMomentPhrase(state: {
  statusShort: string | null;
  minuteLabel: string | null;
}): string {
  if (classifyStatusShort(state.statusShort) === "half_time") return "no intervalo";
  return state.minuteLabel ? `aos ${state.minuteLabel}` : "com o jogo em andamento";
}

/**
 * Selo do palpite gerado ao vivo: "palpite aos 63' (1–0)", "palpite no intervalo
 * (0–0)". Carimbo ilegível: "palpite ao vivo".
 */
export function livePalpiteLabel(stamp: LiveStamp | null): string {
  if (stamp === null) return "palpite ao vivo";
  const moment = liveMomentPhrase({
    statusShort: stamp.status,
    minuteLabel: stamp.minuteLabel,
  });
  const score = stamp.score ? ` (${stamp.score.home}–${stamp.score.away})` : "";
  return `palpite ${moment}${score}`;
}

/** O que uma leitura ao vivo precisa pra ser comparada com o estado de agora. */
export type LiveReadingRow = {
  prediction: { isLive?: boolean | null; liveState?: unknown };
};

const pairEq = (
  a: { home: number; away: number } | null,
  b: { home: number; away: number } | null
): boolean =>
  (a?.home ?? 0) === (b?.home ?? 0) && (a?.away ?? 0) === (b?.away ?? 0);

/**
 * As leituras ao vivo AINDA atuais (o "Gerar só o palpite" ao vivo): mesmo placar,
 * mesmas expulsões do estado de agora e gravadas há no máximo 10 min. Pré-jogo e
 * carimbo ilegível ficam de fora. Mantém a ordem do histórico (mais nova primeiro).
 */
export function currentLiveReadings<R extends LiveReadingRow>(
  history: readonly R[],
  state: {
    score: { home: number; away: number } | null;
    red: { home: number; away: number } | null;
  },
  now: Date,
  maxAgeMs: number = IN_PLAY_SHOW_MAX_AGE_MS
): R[] {
  if (state.score === null) return [];
  return history.filter((row) => {
    if (row.prediction.isLive !== true) return false;
    const stamp = readLiveStamp(row.prediction.liveState);
    if (stamp === null || stamp.score === null) return false;
    if (!pairEq(stamp.score, state.score)) return false;
    if (!pairEq(stamp.red, state.red)) return false;
    const age = now.getTime() - Date.parse(stamp.recordedAt);
    return age >= 0 && age <= maxAgeMs;
  });
}
