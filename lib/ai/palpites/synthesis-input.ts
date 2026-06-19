import { getMarketPresentation } from "@/lib/view/markets/presentation";

import type { FanOutOutcome } from "../best-bet";

// Projeção de UMA análise de mercado pro passo de síntese (#353, Fork A / ADR 0030).
// Camada `lib/ai`: lê os campos JÁ PERSISTIDOS da prediction (edge/confiança/odd) —
// NÃO re-deriva via computeMarketScenarios (evita divergência com o que a row gravou).
//
// `getMarketPresentation` é PURO e SEGURO PRO BUNDLE (não importa @/lib/ai* nem
// @/lib/db) → importável daqui sem inverter a dependência: a advertência do plano é
// contra puxar `toBestBetView`/o agregador da view, não os rótulos de display.
//
// FIREWALL (ADR 0030 §3): `edgePct`/`evPerUnit`/`oddAtRecommendation` viajam como
// DADO (informam o veredito do LLM) — NUNCA aparecem na manchete. O guard estrutural
// (output `.strict()`) + o guard de conteúdo (value-language) garantem isso na saída.
export type MarketAnalysisSummary = {
  marketKey: string;
  marketLabel: string; // do descriptor de display (getMarketPresentation), não da view agregada
  recommendation: string; // selectionKey OU 'pass'
  recommendedLabel: string | null; // rótulo legível da seleção recomendada
  isPass: boolean;
  modelProbPct: number | null; // da seleção recomendada (Number()'d)
  edgePct: number | null; // prediction.edgePct PERSISTIDO, Number()'d (null em pass) — DADO, não vai p/ manchete
  confidencePct: number | null; // prediction.confidencePct, Number()'d
  oddAtRecommendation: number | null;
  rationale: string; // prediction.rationale (sinal p/ a narrativa)
  predictionId: string; // proveniência → headline.sourcePredictionIds
  selections: { key: string; label?: string; modelProbPct: number }[];
};

/**
 * Resume o `FanOutOutcome[]` (em memória, pós-fan-out) numa lista de
 * `MarketAnalysisSummary` pro cartucho de síntese. Filtra os outcomes `ok` (falhas
 * por-mercado são descartadas), lê os campos persistidos da prediction com `Number()`
 * no boundary (Drizzle numeric → string), trata `pass` (sem edge/odd; isPass=true),
 * e ordena por edge desc só como CONTEXTO de prompt (palpites com mais valor primeiro;
 * a ordenação é insumo, não escolha — a manchete é uma síntese, não um pick).
 */
export function summarizeAnalysesForSynthesis(
  outcomes: FanOutOutcome[],
): MarketAnalysisSummary[] {
  const summaries: MarketAnalysisSummary[] = [];
  for (const o of outcomes) {
    if (!o.ok) continue;
    const { prediction, marketKey, selections } = o.result;
    // getMarketPresentation THROWA em marketKey desconhecido. Pula este mercado em vez
    // de anular a manchete inteira (espelha a tolerância de toBestBetView) — defesa
    // contra um mercado novo sem rótulo de presentation; os mercados vivos têm todos.
    let presentation;
    try {
      presentation = getMarketPresentation(marketKey);
    } catch {
      continue;
    }
    const recommendation = prediction.recommendation;
    const isPass = recommendation === "pass";

    // Rótulo legível da seleção recomendada: prefere o `label` threadado (mercados
    // dynamicSelections — nome do jogador) ao presentation.selectionLabel(key) (que
    // devolveria a key crua). `pass`/recomendação não-presente → null.
    const recSel = isPass
      ? undefined
      : selections.find((s) => s.key === recommendation);
    const recommendedLabel = isPass
      ? null
      : (recSel?.label ?? presentation.selectionLabel(recommendation));

    summaries.push({
      marketKey,
      marketLabel: presentation.marketLabel,
      recommendation,
      recommendedLabel,
      isPass,
      modelProbPct: recSel ? recSel.modelProbPct : null,
      edgePct: prediction.edgePct !== null ? Number(prediction.edgePct) : null,
      confidencePct:
        prediction.confidencePct !== null
          ? Number(prediction.confidencePct)
          : null,
      oddAtRecommendation:
        prediction.oddAtRecommendation !== null
          ? Number(prediction.oddAtRecommendation)
          : null,
      rationale: prediction.rationale,
      predictionId: prediction.id,
      selections: selections.map((s) => ({
        key: s.key,
        ...(s.label !== undefined ? { label: s.label } : {}),
        modelProbPct: s.modelProbPct,
      })),
    });
  }
  // Edge desc só como contexto (pass = sem edge → fim da lista). NÃO é o "pick".
  summaries.sort((a, b) => (b.edgePct ?? -Infinity) - (a.edgePct ?? -Infinity));
  return summaries;
}
