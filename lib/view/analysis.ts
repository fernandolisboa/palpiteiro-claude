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
import {
  computeEvPerUnit,
  computeScenarios,
  MIN_EDGE_PP,
  type ScenarioSide,
} from "@/lib/odds/scenario";
import type {
  AnalysisView,
  BetSummary,
  Recommendation,
  ScenarioSideView,
} from "@/lib/view/types";

type PredictionInput = {
  recommendation: "over" | "under" | "pass";
  confidencePct: string | number;
  rationale: string;
  keyFactors: string[];
  minimumOdd: string | number | null;
  oddAtRecommendation: string | number | null;
  bookmaker: string | null;
  impliedProbPct: string | number | null;
  edgePct: string | number | null;
  overOddAtPrediction: string | number | null;
  underOddAtPrediction: string | number | null;
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

// Descrição leiga do lado na frase de framing do break-even da zebra.
const FRAMING_SIDE_LABEL: Record<"over" | "under", string> = {
  over: "pelo menos 3 gols",
  under: "menos de 3 gols",
};

// numeric do Drizzle chega como STRING — converte na borda. Retorna null pra
// valores ausentes/inválidos (históricas sem a coluna preenchida).
function toFiniteNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

// "há 3h" (formatRelativeAgo devolve "3h"); caso-limite <1min vira "há menos
// de 1min" — copy de valor congelado nunca diz "agora"/"hoje" (ADR 0012,
// decisão 2), senão toda análise recém-gerada afirmaria atualidade de uma odd
// que já congelou.
function relativeAgoLabel(createdAt: Date, now: Date): string {
  const ago = formatRelativeAgo(createdAt, now);
  return ago === "agora" ? "há menos de 1min" : `há ${ago}`;
}

// Odd congelada fora do domínio do módulo puro (≤ 1, defensivo) degrada pra
// null — computeScenarios/computeEvPerUnit lançam pra entrada inválida; a view
// renderiza "—".
function toValidOdd(value: string | number | null): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 1 ? n : null;
}

function toScenarioSideView(side: ScenarioSide): ScenarioSideView {
  const edge = formatEdge(side.edgePct);
  return {
    modelProb: formatPct(side.modelProbPct),
    marketProb:
      side.impliedProbPct !== null ? formatPct(side.impliedProbPct) : "—",
    odd: side.odd !== null ? formatOdd(side.odd) : "—",
    edge: edge !== null ? `${edge}pp` : "—",
    expectedReturn: formatEvPct(side.evPerUnit),
    modelBreakEvenOdd: formatOdd(side.modelBreakEvenOdd),
  };
}

// Bloco de cenários (ADR 0012): tudo derivado dos valores CONGELADOS da
// prediction via computeScenarios (precedência: salvo vence recomputado —
// invariante: o edge da coluna recomendada é o edgePct salvo da row). Nunca
// usa o snapshot vivo; as odds atuais já têm casa no OddsCard.
function toScenariosView(
  prediction: PredictionInput,
  confidenceNum: number | null,
): AnalysisView["scenarios"] {
  // Defensivo: confidence fora de (0, 100) degrada o bloco inteiro (o módulo
  // puro lança; aqui dado ruim não pode derrubar a página).
  if (confidenceNum === null || confidenceNum <= 0 || confidenceNum >= 100) {
    return null;
  }
  const isPass = prediction.recommendation === "pass";
  const computed = computeScenarios({
    recommendation: prediction.recommendation,
    confidencePct: confidenceNum,
    oddAtRecommendation: toValidOdd(prediction.oddAtRecommendation),
    impliedProbPct: toFiniteNumber(prediction.impliedProbPct),
    edgePct: toFiniteNumber(prediction.edgePct),
    overOdd: toValidOdd(prediction.overOddAtPrediction),
    underOdd: toValidOdd(prediction.underOddAtPrediction),
  });

  // Lado alternativo (zebra) — só significa algo fora do pass.
  const altKey: "over" | "under" =
    computed.recommended === "under" ? "over" : "under";
  const altSide = altKey === "over" ? computed.over : computed.under;

  // Framing: linguagem de BREAK-EVEN ("só sai do zero") pra zebra — "vale a
  // pena" é reservado ao critério de 5pp do lado recomendado (ADR 0012). No
  // pass, copy de margem de erro: cobre inclusive retorno esperado POSITIVO
  // sob o veredito de não apostar (edge < 5pp não implica EV ≤ 0).
  let framing: string | null = null;
  if (isPass) {
    framing = `vantagens pequenas (abaixo de ${MIN_EDGE_PP}pp) ficam dentro da margem de erro do modelo — por isso não há recomendação`;
  } else if (altSide.breakEvenProbPct !== null) {
    framing = `a aposta em ${FRAMING_SIDE_LABEL[altKey]} só sai do zero se a chance real for maior que ${formatPct(altSide.breakEvenProbPct)} — na análise o modelo estimou ${formatPct(altSide.modelProbPct)}`;
  }

  return {
    over: toScenarioSideView(computed.over),
    under: toScenarioSideView(computed.under),
    recommended: computed.recommended,
    framing,
    note:
      !isPass && altSide.odd === null
        ? "odds do outro lado não registradas nesta análise"
        : null,
  };
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
    // Aviso comparado na precisão de EXIBIÇÃO (formatOdd, 2 casas): o banco
    // guarda 3 casas, e uma diferença que some no arredondamento renderizaria
    // dois números iguais declarados desiguais — a contradição que o aviso
    // existe pra evitar.
    const minOddAboveOddAtRec =
      minOddNum !== null &&
      oddAtRecNum !== null &&
      Number(formatOdd(minOddNum)) > Number(formatOdd(oddAtRecNum));
    if (minOddAboveOddAtRec) {
      evLegend = `a odd registrada na análise (${formatOdd(oddAtRecNum)}) estava abaixo da mínima sugerida (${minOddLabel}) — só vale a pena se a odd subir para ≥ ${minOddLabel}`;
    } else if (evPerUnit !== null && evPerUnit <= 0) {
      evLegend = `na odd registrada na análise, o retorno esperado é negativo — só vale a pena com odd ≥ ${minOddLabel}`;
    } else if (evPerUnit !== null) {
      // evPerUnit > 0 aqui; tom positivo só se o sinal sobrevive ao
      // arredondamento de exibição — "0.0%" verde afirmaria direção que o
      // próprio número não mostra.
      if (formatEvPct(evPerUnit) !== "0.0%") expectedReturnTone = "positive";
      evLegend = `ganho médio por aposta, no longo prazo, se a estimativa de ${formatPct(prediction.confidencePct)} do modelo estiver certa`;
    }
    // evPerUnit null (histórica degradada): retorno é "—", nenhuma legenda —
    // não explicar um número que não existe na tela.
  }

  return {
    kind: KIND_MAP[prediction.recommendation],
    confidence: formatPct(prediction.confidencePct),
    edge: formatEdge(prediction.edgePct),
    minOdd: prediction.minimumOdd !== null ? formatOdd(prediction.minimumOdd) : null,
    scenarios: toScenariosView(prediction, confidenceNum),
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
