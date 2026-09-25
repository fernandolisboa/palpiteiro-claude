// Orçamento de tempo (wall-clock) das actions de análise (#524, review).
//
// A página do jogo roda as actions com `maxDuration = 300` (Vercel mata o request
// depois disso). Os fan-outs (melhor aposta, multi-mercado) chamam predict() em
// SÉRIE, e um modelo adaptive (Opus 5.5 / Sonnet 5 / Fable 5.1) leva 45–90s por
// chamada. Sem teto, o request morre no meio: mercados sem análise, síntese que
// nunca roda. Aqui mora o prazo do run inteiro, medido do início da action, e as
// regras puras de "ainda cabe uma chamada?". Módulo PURO (sem SDK/DB) de propósito:
// predict, o orquestrador do fan-out e o adapter o importam sem ciclo, e os testes
// de action que mockam predict não o mockam.

import type { AIModel } from "./models";

// Prazo do run: 270s a partir do início da action, 30s antes do maxDuration=300 —
// folga pra persistir, revalidar e responder depois da última chamada.
export const ACTION_BUDGET_MS = 270_000;

// Reserva do fim do run pra síntese (Haiku, ADR 0030) no best bet: o fan-out para
// antes, pra a manchete ainda rodar sobre o que terminou.
export const SYNTHESIS_RESERVE_MS = 25_000;

// Folga entre o timeout da request e o prazo: o SDK ainda precisa devolver o erro e
// o predict ainda grava a row de ai_calls antes do prazo.
export const REQUEST_SAFETY_MARGIN_MS = 5_000;

// Tempo mínimo pra valer a pena INICIAR uma chamada paga. Abaixo disso o mercado é
// pulado sem gasto: começar uma chamada que o timeout vai cortar paga tokens e não
// entrega análise. Adaptive pensa antes da tool call; temperature responde direto.
export const MIN_CALL_BUDGET_MS: Record<AIModel["thinkingMode"], number> = {
  adaptive: 60_000,
  temperature: 20_000,
};

// Mensagem de um mercado pulado por falta de tempo no run.
export const DEADLINE_MARKET_MESSAGE = "Tempo esgotado — não analisado.";

export function actionDeadline(startMs: number = Date.now()): number {
  return startMs + ACTION_BUDGET_MS;
}

export function remainingMs(deadlineAt: number, now: number = Date.now()): number {
  return deadlineAt - now;
}

// Ainda cabe uma chamada desse modo de thinking antes do prazo? Sem prazo = cabe.
export function canFitCall(
  deadlineAt: number | undefined,
  thinkingMode: AIModel["thinkingMode"],
  now: number = Date.now(),
): boolean {
  if (deadlineAt === undefined) return true;
  return remainingMs(deadlineAt, now) >= MIN_CALL_BUDGET_MS[thinkingMode];
}

// O prazo do run não comporta mais uma chamada: lançado ANTES do gasto (e antes de
// cobrar slot de rate-limit), pra o orquestrador pular o mercado e os seguintes.
export class AnalysisDeadlineError extends Error {
  constructor() {
    super("analysis deadline exceeded");
    this.name = "AnalysisDeadlineError";
  }
}
