// Gate de analisabilidade market-agnóstico (helper PURO, não-action) — vive FORA
// de predictions.ts ("use server") porque num módulo server TODO export tem que
// ser uma async Server Action (Next falha o build senão). Compartilhado pelos 3
// fan-outs + o caminho de race do friendlyMessage, e testado direto.

import {
  matchUnavailableReason,
  type MatchUnavailableReason,
} from "@/lib/view/match-availability";

const MESSAGE: Record<MatchUnavailableReason, string> = {
  live: "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
  postponed: "Jogo adiado — análise indisponível até o jogo ser remarcado.",
  cancelled: "Este jogo já foi encerrado ou cancelado.",
  finished: "Este jogo já foi encerrado ou cancelado.",
};

/**
 * Pré-jogo = `scheduled` E kickoff no FUTURO (#385) — o gate em si vive em
 * `matchUnavailableReason` (lib/view/match-availability), o MESMO que a página do
 * jogo usa. Retorna `null` quando analisável; senão a copy de UI POR status (pra
 * não dizer "encerrado" num jogo ao vivo). Espelha o gate de `predict.ts` — read
 * grátis, curto-circuita ANTES de qualquer pré-warm/spend.
 *
 * `kickoffAt` é opcional: o caminho de race (friendlyMessage) só tem o status do
 * context; quando ausente, decide só pelo status (sem o gate de kickoff).
 */
export function notAnalyzableMessage(
  status: string,
  kickoffAt?: Date,
  now: Date = new Date()
): string | null {
  const reason = matchUnavailableReason(status, kickoffAt, now);
  return reason === null ? null : MESSAGE[reason];
}
