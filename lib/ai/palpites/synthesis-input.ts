import { getMarketPresentation } from "@/lib/view/markets/presentation";

import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";

import type { FanOutOutcome } from "../best-bet";
import type { PredictResult } from "../predict";

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

// Uma análise já persistida, venha ela do fan-out em memória (PredictResult) ou do
// histórico do DB. `modelProbPct` pode faltar: mercados de seleção dinâmica (artilheiro,
// assistência) só trazem prob pros jogadores que o modelo estimou.
type AnalysisSource = {
  marketKey: string;
  prediction: PredictResult["prediction"];
  selections: {
    key: string;
    label?: string;
    modelProbPct?: number | null;
  }[];
};

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

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
  return summarizeSources(
    outcomes.flatMap((o) => (o.ok ? [o.result] : [])),
  );
}

/**
 * Mesma projeção, a partir do histórico salvo (botão "gerar só o palpite"): a análise
 * MAIS RECENTE de cada mercado, a mesma que a seção "ver análise por mercado" mostra.
 * O histórico vem em ordem desc de criação. Seleção sem prob gravada (`modelProbKnown`
 * false) vira prob ausente, nunca 0%.
 */
export function summarizeSavedAnalysesForSynthesis(
  history: PredictionWithAiCall[],
): MarketAnalysisSummary[] {
  const latestByMarket = new Map<string, AnalysisSource>();
  for (const row of history) {
    const marketKey = row.marketKey ?? "over_under";
    if (latestByMarket.has(marketKey)) continue;
    latestByMarket.set(marketKey, {
      marketKey,
      prediction: row.prediction,
      selections: row.selections.map((s) => ({
        key: s.key,
        ...(s.label !== undefined ? { label: s.label } : {}),
        modelProbPct: s.modelProbKnown === false ? null : s.modelProbPct,
      })),
    });
  }
  return summarizeSources([...latestByMarket.values()]);
}

function summarizeSources(sources: AnalysisSource[]): MarketAnalysisSummary[] {
  const summaries: MarketAnalysisSummary[] = [];
  for (const { prediction, marketKey, selections } of sources) {
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
      modelProbPct: finiteOrNull(recSel?.modelProbPct),
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
      // Só as seleções COM prob: sem isso o schema da síntese rejeitava o input inteiro
      // (um jogador sem estimativa derrubava a manchete de todos os mercados).
      selections: selections.flatMap((s) => {
        const modelProbPct = finiteOrNull(s.modelProbPct);
        if (modelProbPct === null) return [];
        return [
          {
            key: s.key,
            ...(s.label !== undefined ? { label: s.label } : {}),
            modelProbPct,
          },
        ];
      }),
    });
  }
  // Edge desc só como contexto (pass = sem edge → fim da lista). NÃO é o "pick".
  summaries.sort((a, b) => (b.edgePct ?? -Infinity) - (a.edgePct ?? -Infinity));
  return summaries;
}
