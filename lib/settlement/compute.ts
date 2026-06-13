// Dispatcher puro do settlement multi-mercado (#166). Sem I/O: dado uma predição
// (recomendação + seleção + odd + params do mercado) e o fato do jogo, resolve a
// regra do registry e devolve resultado persistido + profit em units, ou null
// pra "não dá pra liquidar — deixa pendente". Reusado pelo cron e pelo override.

import { getSettlementRule } from "@/lib/settlement/registry";
import {
  persistedResult,
  profitForOutcome,
} from "@/lib/settlement/money";
import type { OutcomeResult, ResultData } from "@/lib/settlement/schemas";

// Re-exports: mantêm os import paths `@/lib/settlement/compute` byte-estáveis pros
// consumidores legados (settle.ts, app/actions/settlement.ts, override-form.tsx,
// page.tsx) — aditivo, sem mexer nos call sites. Tipos canônicos vivem em
// schemas.ts; profitForResult vive em money.ts.
export type { OutcomeResult, SettlementOutcome } from "@/lib/settlement/schemas";
export { profitForResult } from "@/lib/settlement/money";

export type Recommendation = "over" | "under" | "pass";

export type Settlement = {
  result: OutcomeResult;
  profitUnits: number;
};

export type SettlementInput = {
  recommendation: Recommendation;
  // settlement_rule_key do mercado (markets.settlementRuleKey) e a key da seleção
  // escolhida (market_selections.key). Nullable: defensivo — uma row sem
  // mercado/seleção não dispatcha (skip), nunca acontece pós-backfill.
  settlementRuleKey: string | null;
  selectionKey: string | null;
  // Params crus do mercado (predictions.marketParams). `unknown`: validado pela
  // própria regra no boundary (jsonb não confiável).
  marketParams: unknown;
  // Entry odd da seleção recomendada. Null em `pass` e (defensivamente) numa
  // over/under malformada — ver o skip case abaixo.
  oddAtRecommendation: number | null;
  stakeUnits: number;
  resultData: ResultData;
};

/**
 * Resolve uma predição contra o fato do jogo via a regra do registry.
 *
 * Retorna `null` pra "não dá pra liquidar — deixa pendente" em vez de inventar um
 * número errado: uma aposta non-pass sem odd de entrada não tem base pra profit,
 * e uma row sem mercado/seleção não tem regra pra dispatchar. `pass` (no-bet)
 * liquida como void/0 ANTES do registry (não é resultado de regra — I3). PODE
 * lançar SettlementError se a regra rejeitar os params; o caller (settle.ts)
 * captura e bucketa em errors sem abortar o batch.
 */
export function computeSettlement(input: SettlementInput): Settlement | null {
  const {
    recommendation,
    settlementRuleKey,
    selectionKey,
    marketParams,
    oddAtRecommendation,
    stakeUnits,
    resultData,
  } = input;

  if (recommendation === "pass") {
    return { result: "void", profitUnits: 0 };
  }

  if (oddAtRecommendation === null) {
    // Aposta non-pass sem entry odd: skip, deixa pendente.
    return null;
  }

  if (!settlementRuleKey || !selectionKey) {
    // Sem mercado/seleção não dá pra dispatchar (defensivo — não ocorre
    // pós-backfill): deixa pendente em vez de chutar.
    return null;
  }

  const rule = getSettlementRule(settlementRuleKey);
  const outcome = rule(selectionKey, marketParams, resultData);
  const profitUnits = profitForOutcome(
    outcome,
    oddAtRecommendation,
    stakeUnits,
  );
  return { result: persistedResult(outcome), profitUnits };
}
