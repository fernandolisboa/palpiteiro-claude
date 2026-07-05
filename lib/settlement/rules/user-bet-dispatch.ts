import { betLegKindEnum } from "@/db/schema";
import type { PalpiteResultData } from "@/db/schema";

import { settleExactScorePalpite } from "./exact_score_palpite";

// Dispatch de settlement das pernas da aposta livre (ADR 0036, Decisão 6). As
// regras são as MESMAS puras `(params, resultData) => won|lost` das regras de
// palpite — sem acoplamento de tabela — então a Fase 1 REUSA a de exact_score
// verbatim. A Fase 2 acrescenta as regras binárias de mercado (linha garantida
// k+0.5) e `first_half_over_under` (sobre halftime), compondo com este dispatch.

export type BetLegKind = (typeof betLegKindEnum.enumValues)[number];

export type BetLegRuleFn = (
  params: unknown,
  resultData: PalpiteResultData,
) => "won" | "lost";

// Só exact_score no tracer. `Partial` porque a maioria dos kinds ainda não tem
// regra (Fase 2) — o lookup no orquestrador é guardado (kind ausente → PENDING).
export const USER_BET_SETTLEMENT_RULES: Partial<Record<BetLegKind, BetLegRuleFn>> =
  {
    exact_score: settleExactScorePalpite,
  };

// Kinds que o settlement sabe liquidar HOJE — o GATE da query de pendências. Cresce
// na Fase 2 junto com USER_BET_SETTLEMENT_RULES (mesma fonte, sem drift).
export const SETTLEABLE_USER_BET_KINDS = [
  "exact_score",
] as const satisfies readonly BetLegKind[];
export type SettleableUserBetKind = (typeof SETTLEABLE_USER_BET_KINDS)[number];

// `settleable` (coluna) derivado DO KIND (Decisão 5), NUNCA do LLM. Fase 1: só
// exact_score é settleable — é o único com caminho de liquidação. Manter alinhado
// com SETTLEABLE_USER_BET_KINDS evita perna settleable=true SEM regra (stuck-pending
// eterno). A Fase 2 estende os dois juntos (Decisão 6: props/mercado true, corners
// false).
export function deriveBetLegSettleable(kind: BetLegKind): boolean {
  return (SETTLEABLE_USER_BET_KINDS as readonly string[]).includes(kind);
}
