import {
  formatCostUsd,
  formatEdge,
  formatEvPct,
  formatGeneratedAt,
  formatModelName,
  formatOdd,
  formatPct,
  formatRelativeAgo,
} from "@/lib/format";
import { computeEvPerUnit, MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { AnalysisView, BetSummary, Recommendation } from "@/lib/view/types";

type PredictionInput = {
  recommendation: "over" | "under" | "pass";
  confidencePct: string | number;
  rationale: string;
  keyFactors: string[];
  minimumOdd: string | number | null;
  oddAtRecommendation: string | number | null;
  bookmaker: string | null;
  edgePct: string | number | null;
  modelVersion: string;
  promptVersion: string;
  createdAt: Date;
};

type AiCallInput = {
  costUsd: string | number;
};

const KIND_MAP: Record<PredictionInput["recommendation"], Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

const BET_SUMMARY: Record<"over" | "under", BetSummary> = {
  over: { market: "Mais de 2.5 gols", plain: "pelo menos 3 gols no jogo" },
  under: { market: "Menos de 2.5 gols", plain: "no máximo 2 gols no jogo" },
};

// numeric do Drizzle chega como STRING — converte na borda. Retorna null pra
// valores ausentes/inválidos (históricas sem a coluna preenchida).
function toFiniteNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

// "há 3h" (formatRelativeAgo devolve "3h"); caso-limite <1min vira só "agora".
function relativeAgoLabel(createdAt: Date, now: Date): string {
  const ago = formatRelativeAgo(createdAt, now);
  return ago === "agora" ? "agora" : `há ${ago}`;
}

export function toAnalysisView(
  prediction: PredictionInput,
  aiCall: AiCallInput | null,
  now: Date = new Date(),
): AnalysisView {
  const recommendation = prediction.recommendation;
  const isPass = recommendation === "pass";
  const oddAtRecNum = toFiniteNumber(prediction.oddAtRecommendation);
  const minOddNum = toFiniteNumber(prediction.minimumOdd);
  const confidenceNum = toFiniteNumber(prediction.confidencePct);

  // EV do lado recomendado na odd CONGELADA da análise (nunca na odd viva —
  // o OddsCard cobre as atuais). computeEvPerUnit exige odd > 1; valores fora
  // do domínio (defensivo) degradam pra null → "—" na UI.
  const evPerUnit =
    !isPass && oddAtRecNum !== null && oddAtRecNum > 1 && confidenceNum !== null
      ? computeEvPerUnit(confidenceNum, oddAtRecNum)
      : null;

  // Estados de contradição (ADR 0012): o aviso de minimum_odd acima da odd
  // registrada tem precedência sobre a nota de retorno negativo; ambos tiram o
  // tom positivo do retorno. "vale a pena" é reservado ao critério de odd
  // mínima do lado recomendado.
  let expectedReturnTone: AnalysisView["expectedReturnTone"] = "neutral";
  let evLegend: string | null = null;
  if (!isPass) {
    const minOddLabel = formatOdd(prediction.minimumOdd);
    if (minOddNum !== null && oddAtRecNum !== null && minOddNum > oddAtRecNum) {
      evLegend = `a odd registrada na análise (${formatOdd(oddAtRecNum)}) estava abaixo da mínima sugerida (${minOddLabel}) — só vale a pena se a odd subir para ≥ ${minOddLabel}`;
    } else if (evPerUnit !== null && evPerUnit <= 0) {
      evLegend = `na odd registrada na análise, o retorno esperado é negativo — só vale a pena com odd ≥ ${minOddLabel}`;
    } else {
      if (evPerUnit !== null && evPerUnit > 0) expectedReturnTone = "positive";
      evLegend = `ganho médio por aposta, no longo prazo, se a estimativa de ${formatPct(prediction.confidencePct)} do modelo estiver certa`;
    }
  }

  return {
    kind: KIND_MAP[prediction.recommendation],
    confidence: formatPct(prediction.confidencePct),
    edge: formatEdge(prediction.edgePct),
    minOdd: prediction.minimumOdd !== null ? formatOdd(prediction.minimumOdd) : null,
    betSummary: isPass ? null : BET_SUMMARY[recommendation],
    oddAtRec: isPass ? null : formatOdd(prediction.oddAtRecommendation),
    oddAtRecAgo: isPass ? null : relativeAgoLabel(prediction.createdAt, now),
    bookmaker: isPass ? null : prediction.bookmaker,
    expectedReturn: isPass ? null : formatEvPct(evPerUnit),
    expectedReturnTone,
    evLegend,
    minEdgeLabel: `${MIN_EDGE_PP}pp`,
    rationale: prediction.rationale,
    factors: prediction.keyFactors,
    generatedAt: formatGeneratedAt(prediction.createdAt),
    promptVersion: prediction.promptVersion,
    model: formatModelName(prediction.modelVersion),
    costUsd: formatCostUsd(aiCall?.costUsd ?? null),
  };
}
