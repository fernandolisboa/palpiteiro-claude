import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import type { JudgmentQuestionId } from "@/lib/ai/judgments/types";
import { judgmentFactorPhrases } from "@/lib/ai/markets/_narrator/labels";
import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";
import { claimEffect } from "@/lib/user-palpite/evidence";
import { hasContextNote } from "@/lib/user-palpite/labels";
import { PredictionUserContextSchema } from "@/lib/user-palpite/types";
import { getMarketPresentation } from "@/lib/view/markets/presentation";

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
  rationale: string; // prediction.rationale (sinal p/ a narrativa); ver synthesisRationale
  predictionId: string; // proveniência → headline.sourcePredictionIds
  selections: { key: string; label?: string; modelProbPct: number }[];
};

// Uma análise já persistida, venha ela do fan-out em memória (PredictResult) ou do
// histórico do DB. `modelProbPct` null: mercados de seleção dinâmica (artilheiro,
// assistência) só trazem prob pros jogadores que o modelo estimou.
type AnalysisSource = {
  marketKey: string;
  prediction: PredictResult["prediction"];
  selections: {
    key: string;
    label?: string;
    modelProbPct: number | null;
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
 * MAIS RECENTE de cada mercado, a mesma que "Ler análise completa" mostra na página do jogo.
 * O histórico vem em ordem desc de criação. Seleção sem prob gravada (null) segue
 * sem prob, nunca 0%.
 */
//
// Pré-jogo e ao vivo não se misturam (#594): `live: false` (default) lê só as análises
// de pré-jogo (uma leitura ao vivo nunca entra no palpite de antes do apito);
// `live: true`, só as leituras ao vivo (o chamador já filtrou as do momento atual).
export function summarizeSavedAnalysesForSynthesis(
  history: PredictionWithAiCall[],
  opts: { live?: boolean } = {},
): MarketAnalysisSummary[] {
  const wantLive = opts.live === true;
  const latestByMarket = new Map<string, AnalysisSource>();
  for (const row of history) {
    if ((row.prediction.isLive === true) !== wantLive) continue;
    const marketKey = row.marketKey ?? "over_under";
    if (latestByMarket.has(marketKey)) continue;
    latestByMarket.set(marketKey, {
      marketKey,
      prediction: row.prediction,
      selections: row.selections.map((s) => ({
        key: s.key,
        ...(s.label !== undefined ? { label: s.label } : {}),
        modelProbPct: s.modelProbPct,
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
    // Com a linha (over/under): uma análise salva pode ser de outra linha (1.5, 3.5);
    // "Over" sozinho faria a síntese assumir 2.5.
    const line = finiteOrNull(prediction.marketParams?.line) ?? presentation.defaultLine;
    const recommendedLabel = isPass
      ? null
      : (recSel?.label ?? presentation.outcomeLabel(recommendation, line));

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
      rationale: synthesisRationale(prediction),
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

// ─── Contexto extra (#565) fora da síntese ───────────────────────────────────

// Times genéricos nas frases de fator: a síntese já recebe os nomes no cabeçalho.
const GENERIC_TEAMS = { home: "mandante", away: "visitante" };

/**
 * O racional que a síntese vê. A manchete pode ser compartilhada (/p) e a síntese não
 * sabe de onde veio cada fator: quando o contexto extra do usuário moveu algum fator
 * (PLAN-565 §13.2, emenda do ADR 0055) ou deixou nota pro narrador (#569), o racional do
 * narrador (que cita o que a pessoa informou) NÃO vai. No lugar, um racional montado em código só com os fatores do JEV
 * que o usuário não moveu; sem nenhum, vazio (a linha "Racional" some). As probs e a
 * seleção seguem as da row.
 */
function synthesisRationale(prediction: PredictResult["prediction"]): string {
  const judgments = prediction.judgments;
  if (judgments?.engine !== "code_jev" || judgments.userContext === undefined) {
    return prediction.rationale;
  }
  const parsed = PredictionUserContextSchema.safeParse(judgments.userContext);
  // Contexto ilegível: na dúvida, trata como movido.
  const userMoved = parsed.success
    ? new Set(
        parsed.data.claims.flatMap((c) => claimEffect(c, judgments.answers ?? null).moved),
      )
    : null;
  // Nota do contexto extra (#569): o racional a cita mesmo sem fator movido.
  const noted = !parsed.success || hasContextNote(parsed.data.claims);
  if (userMoved?.size === 0 && !noted) return prediction.rationale;
  if (!userMoved || !judgments.answers || !judgments.multipliers) return "";
  const phrases = judgmentFactorPhrases(
    judgments.answers,
    withoutFactors(judgments.multipliers, userMoved),
    GENERIC_TEAMS,
  );
  return phrases.length > 0 ? `Fatores do modelo: ${phrases.join("; ")}.` : "";
}

function withoutFactors(
  m: JudgmentMultipliers,
  drop: ReadonlySet<JudgmentQuestionId>,
): JudgmentMultipliers {
  const strip = (side: JudgmentMultipliers["home"]) => ({
    ...side,
    factors: Object.fromEntries(
      Object.entries(side.factors).filter(([id]) => !drop.has(id as JudgmentQuestionId)),
    ),
  });
  return { home: strip(m.home), away: strip(m.away) };
}
