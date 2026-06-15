import { computeEvPerUnit, computeMarketScenarios } from "@/lib/odds/scenario";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import { toAnalysisView } from "@/lib/view/analysis";
import type {
  BestBetEntry,
  BestBetMarketError,
  BestBetRank,
  BestBetView,
} from "@/lib/view/types";

import type { FanOutOutcome } from "@/lib/ai/best-bet";
import type { Prediction } from "@/lib/ai/predict";

// Mapper do modo "melhor aposta do jogo" (#178). Roda SERVER-SIDE (chamado pela
// action analyzeBestBet) e devolve um BestBetView de tipos puros — o painel
// "use client" só recebe o resultado como props. As mensagens de erro amigáveis são
// produzidas na action (server-only) e passadas aqui; este módulo NUNCA chama
// friendlyMessage nem importa @/lib/db / @/lib/ai (valor) — só tipos.

type AiCallCost = { costUsd: string | number } | null;

// Insumos de ranqueamento LIDOS dos mesmos números que os cards mostram:
//  - edge da seleção RECOMENDADA via computeMarketScenarios (a MESMA fn da grade
//    N-vias do card; já normaliza pelo impliedSumTarget do descriptor);
//  - evPerUnit = computeEvPerUnit(confidencePct, oddAtRecommendation) — idêntico ao
//    expectedReturn que o card renderiza (toAnalysisView).
// odd CONGELADA (ADR 0012), nunca a live. Em pass, edge/EV = null (sem aposta).
function computeRank(
  prediction: Prediction,
  marketKey: string,
  selections: { key: string; modelProbPct: number; odd: number | null }[],
): BestBetRank {
  const recommendation = prediction.recommendation;
  const isPass = recommendation === "pass";
  const confidencePct = Number(prediction.confidencePct); // numeric NOT NULL → sempre número
  const oddAtRecommendation =
    prediction.oddAtRecommendation !== null
      ? Number(prediction.oddAtRecommendation)
      : null;
  const impliedSumTarget = getDescriptor(marketKey)?.impliedSumTarget ?? 1;

  let edgePct: number | null = null;
  if (!isPass) {
    const recSel = computeMarketScenarios({
      selections,
      recommendedKey: recommendation,
      impliedSumTarget,
    }).selections.find((s) => s.key === recommendation);
    edgePct = recSel?.edgePct ?? null;
  }

  // Espelha toAnalysisView (expectedReturn): EV só com odd > 1 e confiança finita.
  const evPerUnit =
    !isPass &&
    oddAtRecommendation !== null &&
    oddAtRecommendation > 1 &&
    Number.isFinite(confidencePct)
      ? computeEvPerUnit(confidencePct, oddAtRecommendation)
      : null;

  return {
    edgePct,
    evPerUnit,
    confidencePct,
    oddAtRecommendation,
    impliedSumTarget,
    isPass,
  };
}

/**
 * Monta o BestBetView a partir dos outcomes do fan-out. Para cada sucesso constrói
 * a AnalysisView pelo MESMO `toAnalysisView` do analyzeMatch (lendo a aiCall pra
 * custo) e os insumos de rank. Falhas (pré-warm + predict) viram `errors` por-mercado
 * — deduplicadas por marketKey e excluindo qualquer mercado que acabou virando entry
 * (um mercado nunca é "disponível" e "indisponível" ao mesmo tempo).
 */
export function toBestBetView(
  outcomes: FanOutOutcome[],
  aiCallByMarketKey: ReadonlyMap<string, AiCallCost>,
  preWarmErrors: { marketKey: string; message: string }[] = [],
): BestBetView {
  const entries: BestBetEntry[] = [];
  const rawErrors: BestBetMarketError[] = preWarmErrors.map((e) => ({
    marketKey: e.marketKey,
    marketLabel: getMarketPresentation(e.marketKey).marketLabel,
    message: e.message,
  }));

  for (const o of outcomes) {
    const marketLabel = getMarketPresentation(o.marketKey).marketLabel;
    if (!o.ok) {
      rawErrors.push({ marketKey: o.marketKey, marketLabel, message: o.message });
      continue;
    }
    const { prediction, marketKey, selections } = o.result;
    const aiCall = aiCallByMarketKey.get(marketKey) ?? null;
    const analysis = toAnalysisView(
      {
        recommendation: prediction.recommendation,
        confidencePct: prediction.confidencePct,
        rationale: prediction.rationale,
        keyFactors: prediction.keyFactors,
        minimumOdd: prediction.minimumOdd,
        oddAtRecommendation: prediction.oddAtRecommendation,
        bookmaker: prediction.bookmaker,
        impliedProbPct: prediction.impliedProbPct,
        edgePct: prediction.edgePct,
        overOddAtPrediction: prediction.overOddAtPrediction,
        underOddAtPrediction: prediction.underOddAtPrediction,
        modelVersion: prediction.modelVersion,
        promptVersion: prediction.promptVersion,
        createdAt: prediction.createdAt,
        marketKey,
        line: prediction.marketParams?.line ?? null,
        stakeUnits: prediction.stakeUnits,
        selections,
      },
      aiCall ? { costUsd: aiCall.costUsd } : null,
    );
    entries.push({
      marketKey,
      marketLabel,
      analysis,
      rank: computeRank(prediction, marketKey, selections),
    });
  }

  // Um mercado que virou entry (predict OK) nunca é "indisponível", mesmo que o
  // pré-warm tenha falhado antes (odds já frescas de um run anterior). Dedup por
  // marketKey pra um mercado contar no máximo uma vez.
  const successKeys = new Set(entries.map((e) => e.marketKey));
  const seen = new Set<string>();
  const errors: BestBetMarketError[] = [];
  for (const e of rawErrors) {
    if (successKeys.has(e.marketKey) || seen.has(e.marketKey)) continue;
    seen.add(e.marketKey);
    errors.push(e);
  }

  return {
    entries,
    errors,
    llmCalls: entries.length,
    unavailableMarkets: errors.length,
  };
}
