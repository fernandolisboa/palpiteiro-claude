import { betLegKindEnum } from "@/db/schema";
import type { PalpiteResultData } from "@/db/schema";

import { settleCleanSheetPalpite } from "./clean_sheet_palpite";
import { settleExactScorePalpite } from "./exact_score_palpite";
import { settleFirstHalfScorePalpite } from "./first_half_score_palpite";
import { settleFirstToScorePalpite } from "./first_to_score_palpite";
import { settleMarginPalpite } from "./margin_palpite";
import {
  settleBttsLeg,
  settleDoubleChanceLeg,
  settleFirstHalfOverUnderLeg,
  settleMatchResultLeg,
  settleOverUnderLeg,
} from "./user-bet-market";

// Dispatch de settlement das pernas da aposta livre (ADR 0036, Decisão 6). As regras
// são puras `(params, resultData) => won|lost` — os kinds goal/half/event-derived
// REUSAM as regras de palpite verbatim; os kinds de mercado (over_under/match_result/
// btts/double_chance) e first_half_over_under são NOVOS (user-bet-market.ts, linha
// garantida k+0.5 → binário sem push). `cards`/`corners` ficam FORA (Decisão 3: none):
// corners é não-liquidável; cards é web-grounded e depende do sidecar de attempts
// (deferido) → settleable=false na Fase 2 pra não virar stuck-pending eterno.

export type BetLegKind = (typeof betLegKindEnum.enumValues)[number];

export type BetLegRuleFn = (
  params: unknown,
  resultData: PalpiteResultData,
) => "won" | "lost";

export const USER_BET_SETTLEMENT_RULES: Partial<Record<BetLegKind, BetLegRuleFn>> =
  {
    // goal-derived (reuso verbatim das regras de palpite)
    exact_score: settleExactScorePalpite,
    margin: settleMarginPalpite,
    clean_sheet: settleCleanSheetPalpite,
    first_half_score: settleFirstHalfScorePalpite,
    first_to_score: settleFirstToScorePalpite,
    // mercado + 1º-tempo total (regras novas, binárias k+0.5)
    over_under: settleOverUnderLeg,
    match_result: settleMatchResultLeg,
    btts: settleBttsLeg,
    double_chance: settleDoubleChanceLeg,
    first_half_over_under: settleFirstHalfOverUnderLeg,
  };

// Kinds que o settlement sabe liquidar HOJE — o GATE da query de pendências. Deriva
// das CHAVES do dispatch (fonte única, sem drift com deriveBetLegSettleable).
export const SETTLEABLE_USER_BET_KINDS = Object.keys(
  USER_BET_SETTLEMENT_RULES,
) as BetLegKind[];

const SETTLEABLE_SET: ReadonlySet<BetLegKind> = new Set(
  SETTLEABLE_USER_BET_KINDS,
);

export type SettleableUserBetKind = BetLegKind;

// Kinds que exigem o fetch extra de /fixtures/events no cron (espelha
// EVENT_BACKED_PALPITE_TYPES). Só first_to_score. Os demais usam só getFixtureResult
// (placar + halftime).
export const EVENT_BACKED_USER_BET_KINDS = new Set<BetLegKind>(["first_to_score"]);

// `settleable` (coluna) derivado DO KIND (Decisão 5), NUNCA do LLM. É exatamente o
// conjunto com regra de settlement (cresce junto com o dispatch, sem drift). cards/
// corners → false na Fase 2 (fora do dispatch).
export function deriveBetLegSettleable(kind: BetLegKind): boolean {
  return SETTLEABLE_SET.has(kind);
}
