import type { PalpiteResultData } from "@/db/schema";
import type { SettleablePalpiteType } from "@/lib/ai/palpites/settleable";
import { settleCleanSheetPalpite } from "@/lib/settlement/rules/clean_sheet_palpite";
import { settleExactScorePalpite } from "@/lib/settlement/rules/exact_score_palpite";
import { settleFirstHalfScorePalpite } from "@/lib/settlement/rules/first_half_score_palpite";
import { settleFirstToScorePalpite } from "@/lib/settlement/rules/first_to_score_palpite";
import { settleMarginPalpite } from "@/lib/settlement/rules/margin_palpite";

// Dispatch por TIPO de palpite (#354) — o caminho de PALPITE tem seu próprio registry,
// DISJUNTO do registry de VALOR (lib/settlement/registry.ts, ADR 0028: palpite não é
// recomendação de valor). Cada regra é (params, resultData) -> "won"|"lost" e lança
// SettlementError em dado faltando/ambíguo (prefer-skip → o orquestrador deixa PENDING).
type PalpiteRuleFn = (
  params: unknown,
  resultData: PalpiteResultData,
) => "won" | "lost";

export const PALPITE_SETTLEMENT_RULES: Record<
  SettleablePalpiteType,
  PalpiteRuleFn
> = {
  exact_score: settleExactScorePalpite,
  margin: settleMarginPalpite,
  clean_sheet: settleCleanSheetPalpite,
  first_half_score: settleFirstHalfScorePalpite,
  first_to_score: settleFirstToScorePalpite,
};

// Tipos que exigem o fetch extra de /fixtures/events no cron de palpite (espelha
// EVENT_BACKED_RULE_KEYS de settle.ts). Data-driven: só uma row pendente com um destes
// tipos dispara o fetch de eventos. Os demais settleable usam só getFixtureResult
// (placar + halftime), sem egress extra.
export const EVENT_BACKED_PALPITE_TYPES = new Set<SettleablePalpiteType>([
  "first_to_score",
]);
