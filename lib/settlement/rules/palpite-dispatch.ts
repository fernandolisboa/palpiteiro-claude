import type { PalpiteResultData } from "@/db/schema";
import type { SettleablePalpiteType } from "@/lib/ai/palpites/settleable";
import { settleCardsPalpite } from "@/lib/settlement/rules/cards_palpite";
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
  cards: settleCardsPalpite,
};

// Tipos que exigem o fetch extra de /fixtures/events no cron de palpite (espelha
// EVENT_BACKED_RULE_KEYS de settle.ts). Data-driven: só uma row pendente com um destes
// tipos dispara o fetch de eventos. Os demais settleable usam só getFixtureResult
// (placar + halftime), sem egress extra.
export const EVENT_BACKED_PALPITE_TYPES = new Set<SettleablePalpiteType>([
  "first_to_score",
]);

// Tipos liquidados por EXTRAÇÃO WEB-GROUNDED (#394, ADR 0033): o cron dispara uma busca
// web (seam #377, getProviderForModel().runAnalysis) em vez de api-football. `cards` é o
// único hoje. DISJUNTO de EVENT_BACKED por construção: um tipo nos dois dispararia
// api-football (/fixtures/events) E web search pro MESMO jogo = crédito + taxa
// duplicados. A invariante abaixo trava isso em IMPORT-TIME (não num teste que um
// contribuidor pode pular). cards NÃO tem caminho /fixtures/events → fica fora de
// EVENT_BACKED.
export const WEB_GROUNDED_PALPITE_TYPES = new Set<SettleablePalpiteType>([
  "cards",
]);

// Invariante de import-time: EVENT_BACKED ∩ WEB_GROUNDED === ∅. Roda no carregamento do
// módulo — qualquer tipo adicionado aos dois conjuntos derruba o boot, antes de qualquer
// chamada paga.
for (const t of WEB_GROUNDED_PALPITE_TYPES) {
  if (EVENT_BACKED_PALPITE_TYPES.has(t)) {
    throw new Error(
      `palpite type '${t}' não pode ser EVENT_BACKED e WEB_GROUNDED ao mesmo tempo (double-fetch: crédito api-football + taxa web search)`,
    );
  }
}
