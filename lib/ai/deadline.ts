// Orçamento de tempo (wall-clock) das actions de análise (#524, review).
//
// A página do jogo roda as actions com `maxDuration = 300` (Vercel mata o request
// depois disso). Os fan-outs (melhor aposta, multi-mercado) chamam predict() em
// SÉRIE, e um modelo adaptive (Opus 5.5 / Sonnet 5 / Fable 5.1) leva 45–90s por
// chamada. Sem teto, o request morre no meio: mercados sem análise, síntese que
// nunca roda. Aqui mora o prazo do run inteiro, medido do início da action, e as
// regras puras de "ainda cabe uma chamada?". Módulo PURO (sem SDK/DB) de propósito:
// predict, o orquestrador do fan-out e a síntese o importam sem ciclo (a estimativa
// de timeout que ele usa, timeouts.ts, também é pura e não o importa), e os testes
// de action que mockam predict não o mockam.

import type { Effort } from "./generation-params";
import type { AIModel } from "./models";
import { adaptiveTimeoutMs } from "./providers/anthropic/timeouts";

// Prazo do run: 270s a partir do início da action, 30s antes do maxDuration=300 —
// folga pra persistir, revalidar e responder depois da última chamada.
export const ACTION_BUDGET_MS = 270_000;

// Reserva do fim do run pra síntese (Haiku, ADR 0030) no best bet: o fan-out para
// antes, pra a manchete ainda rodar sobre o que terminou.
export const SYNTHESIS_RESERVE_MS = 25_000;

// Tempo mínimo pra valer a pena INICIAR uma chamada paga. Abaixo disso o mercado é
// pulado sem gasto nem slot: começar uma chamada que o timeout vai cortar paga
// tokens e não entrega análise. Temperature responde direto (20s). Adaptive pensa
// antes da tool call: no mínimo 120s, ou METADE do timeout estimado pro max_tokens/
// effort da chamada (lib/ai/providers/anthropic/timeouts.ts) se for maior — um
// mercado marginal vira "Tempo esgotado" em vez de uma chamada paga cortada no meio.
const MIN_TEMPERATURE_BUDGET_MS = 20_000;
const MIN_ADAPTIVE_BUDGET_MS = 120_000;
const ADAPTIVE_BUDGET_SHARE = 0.5;

// O formato da chamada que decide o mínimo. Sem max_tokens (checagem grossa, antes
// de resolver os parâmetros de geração) vale só o piso do modo.
export type CallShape = {
  thinkingMode: AIModel["thinkingMode"];
  maxTokens?: number;
  effort?: Effort;
};

export function minCallBudgetMs(call: CallShape): number {
  if (call.thinkingMode === "temperature") return MIN_TEMPERATURE_BUDGET_MS;
  if (call.maxTokens === undefined) return MIN_ADAPTIVE_BUDGET_MS;
  return Math.max(
    MIN_ADAPTIVE_BUDGET_MS,
    adaptiveTimeoutMs(call.maxTokens, call.effort) * ADAPTIVE_BUDGET_SHARE,
  );
}

// Mensagem de um mercado pulado por falta de tempo no run.
export const DEADLINE_MARKET_MESSAGE = "Tempo esgotado — não analisado.";

export function actionDeadline(startMs: number = Date.now()): number {
  return startMs + ACTION_BUDGET_MS;
}

export function remainingMs(deadlineAt: number, now: number = Date.now()): number {
  return deadlineAt - now;
}

// Ainda cabe uma chamada desse formato (ou só desse modo de thinking) antes do
// prazo? Sem prazo = cabe.
export function canFitCall(
  deadlineAt: number | undefined,
  call: CallShape | AIModel["thinkingMode"],
  now: number = Date.now(),
): boolean {
  if (deadlineAt === undefined) return true;
  const shape = typeof call === "string" ? { thinkingMode: call } : call;
  return remainingMs(deadlineAt, now) >= minCallBudgetMs(shape);
}

// O prazo do run não comporta mais uma chamada: lançado ANTES do gasto (e antes de
// cobrar slot de rate-limit), pra o orquestrador pular o mercado e os seguintes.
export class AnalysisDeadlineError extends Error {
  constructor() {
    super("analysis deadline exceeded");
    this.name = "AnalysisDeadlineError";
  }
}
