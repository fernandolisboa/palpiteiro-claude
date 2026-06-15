import {
  formatCostUsd,
  formatEdge,
  formatEvPct,
  formatGeneratedAt,
  formatModelName,
  formatOdd,
  formatPct,
  formatRelativeAgo,
  formatStakeUnits,
} from "@/lib/format";
import {
  computeEvPerUnit,
  computeMarketScenarios,
  computeScenarios,
  MIN_EDGE_PP,
  type ScenarioSelection,
  type Scenarios,
  type ScenarioSide,
} from "@/lib/odds/scenario";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import {
  getMarketPresentation,
  type MarketPresentation,
} from "@/lib/view/markets/presentation";
import type {
  AnalysisView,
  OutcomeView,
  ScenarioSideView,
} from "@/lib/view/types";

type PredictionInput = {
  // = key da seleção escolhida (multi-mercado, #173) ou "pass". A ramificação por
  // IDENTIDADE do toAnalysisView mantém over_under no caminho binário congelado e
  // manda os demais mercados (1X2, btts) pro caminho N-vias canônico.
  recommendation:
    | "over"
    | "under"
    | "pass"
    | "home"
    | "draw"
    | "away"
    | "yes"
    | "no"
    | "home_or_draw"
    | "away_or_draw"
    | "home_or_away";
  confidencePct: string | number;
  rationale: string;
  keyFactors: string[];
  minimumOdd: string | number | null;
  oddAtRecommendation: string | number | null;
  bookmaker: string | null;
  impliedProbPct: string | number | null;
  edgePct: string | number | null;
  modelVersion: string;
  promptVersion: string;
  createdAt: Date;
  // Identidade de mercado (#169, additive/opcional). O page/action ainda NÃO
  // passa (passa só o shape over/under) — default `over_under` mantém a paridade
  // até o #170 ligar a fiação. `line` cai pra defaultLine da apresentação.
  marketKey?: string;
  line?: number | null;
  // Stake da aposta (numeric do Drizzle → string). #170 liga as call sites
  // (page + action). Ausente → stakeUnits null na view (compatibilidade).
  stakeUnits?: string | number | null;
  // Candidate set N-vias (#173): uma entrada por selectionKey com a prob do modelo
  // e a odd congelada. Carrier vindo de predict() (action) ou de PSO (page). Quando
  // `length > 2`, toAnalysisView ramifica pro caminho N-vias canônico
  // (computeMarketScenarios → toOutcomesView) e mantém 1X2 FORA do scenario binário.
  // Ausente/≤2 → caminho binário congelado (over/under byte-idêntico).
  selections?: { key: string; modelProbPct: number; odd: number | null }[];
};

type AiCallInput = {
  costUsd: string | number;
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

// Cenários binários CONGELADOS (ADR 0012) via computeScenarios (precedência:
// salvo vence recomputado — invariante: o edge da coluna recomendada é o edgePct
// salvo da row). Roteado por DADO (existência do par congelado over/under), NUNCA
// por `if (market === "over_under")` — só over/under carrega esse par em #169; o
// caminho N-vias canônico (computeMarketScenarios → toOutcomesView) cobre o resto.
// Defensivo: confidence fora de (0, 100) degrada o bloco inteiro (o módulo puro
// lança; aqui dado ruim não pode derrubar a página) → null.
// `computeScenarios` é binário DE PROPÓSITO (over/under/pass; plan §C2): a
// derivação 100−x do lado oposto só vale em N=2. Em N≥3 (1X2) o bloco binário não
// se aplica — a ramificação N-vias do toAnalysisView (computeMarketScenarios) é o
// GATE que cobre esse caso (§F, agora LIGADO: candidate set >2 → caminho N-vias,
// nunca chega aqui). Esta guarda permanece defensiva: uma recomendação não-binária
// SEM candidate set (≤2) degrada o bloco (null), como confidence fora de domínio.
function isBinaryRecommendation(
  rec: PredictionInput["recommendation"],
): rec is "over" | "under" | "pass" {
  return rec === "over" || rec === "under" || rec === "pass";
}

function computeBinaryScenarios(
  prediction: PredictionInput,
  confidenceNum: number | null,
): Scenarios | null {
  if (confidenceNum === null || confidenceNum <= 0 || confidenceNum >= 100) {
    return null;
  }
  if (!isBinaryRecommendation(prediction.recommendation)) {
    return null;
  }
  // Par over/under congelado: a fonte é a grade de seleções (prediction_selection_odds,
  // keys "over"/"under") — NÃO mais o par legado over/under_odd_at_prediction
  // (dropado no contract da Fase 5). predict() grava a PSO byte-idêntica ao par
  // legado; rows históricas sem par (pré-ADR-0012) carregam odd null → o MESMO
  // degrade ("odds não registradas").
  const overOdd = prediction.selections?.find((s) => s.key === "over")?.odd ?? null;
  const underOdd =
    prediction.selections?.find((s) => s.key === "under")?.odd ?? null;
  return computeScenarios({
    recommendation: prediction.recommendation,
    confidencePct: confidenceNum,
    oddAtRecommendation: toValidOdd(prediction.oddAtRecommendation),
    impliedProbPct: toFiniteNumber(prediction.impliedProbPct),
    edgePct: toFiniteNumber(prediction.edgePct),
    overOdd: toValidOdd(overOdd),
    underOdd: toValidOdd(underOdd),
  });
}

// framing + note do cenário binário CONGELADO, computados no topo da
// AnalysisView (R4) — byte-idênticos à string pré-relocação.
//
// Framing: linguagem de BREAK-EVEN ("só sai do zero") pra zebra — "vale a pena"
// é reservado ao critério de 5pp do lado recomendado (ADR 0012). No pass, copy
// de margem de erro: cobre inclusive retorno esperado POSITIVO sob o veredito de
// não apostar (edge < 5pp não implica EV ≤ 0). Mercado N-vias (1X2): framing/note
// null — o break-even binário da zebra não tem análogo (R4).
function computeBinaryFramingNote(
  computed: Scenarios,
  presentation: MarketPresentation,
  line: number | null,
): { framing: string | null; note: string | null } {
  const isPass = computed.recommended === null;
  // Lado alternativo (zebra) — só significa algo fora do pass.
  const altKey: "over" | "under" =
    computed.recommended === "under" ? "over" : "under";
  const altSide = altKey === "over" ? computed.over : computed.under;

  let framing: string | null = null;
  if (isPass) {
    framing = `vantagens pequenas (abaixo de ${MIN_EDGE_PP}pp) ficam dentro da margem de erro do modelo — por isso não há recomendação`;
  } else if (altSide.breakEvenProbPct !== null) {
    framing = `a aposta em ${presentation.framingLabel(altKey, line)} só sai do zero se a chance real for maior que ${formatPct(altSide.breakEvenProbPct)} — na análise o modelo estimou ${formatPct(altSide.modelProbPct)}`;
  }
  return {
    framing,
    note:
      !isPass && altSide.odd === null
        ? "odds do outro lado não registradas nesta análise"
        : null,
  };
}

// Uma seleção → OutcomeView, REUSANDO toScenarioSideView pra garantir formatação
// byte-idêntica ao bloco de cenários (paridade). `breakEven` é a odd de
// equilíbrio do modelo (modelBreakEvenOdd), nunca a probabilidade. ScenarioSide e
// ScenarioSelection compartilham os campos numéricos, então serve aos dois caminhos.
function toOutcomeView(
  side: ScenarioSide,
  key: string,
  presentation: MarketPresentation,
  line: number | null,
  isRecommended: boolean,
): OutcomeView {
  const sv = toScenarioSideView(side);
  return {
    id: key,
    label: presentation.outcomeLabel(key, line),
    scenarioLabel: presentation.scenarioLabel(key, line),
    modelProb: sv.modelProb,
    marketProb: sv.marketProb,
    odd: sv.odd,
    edge: sv.edge,
    expectedReturn: sv.expectedReturn,
    breakEven: sv.modelBreakEvenOdd,
    isRecommended,
  };
}

// Outcomes do over/under a partir do `Scenarios` binário — ordem [over, under]
// (espelha market_selections.sort_order por construção, sem read de DB).
function toBinaryOutcomes(
  computed: Scenarios,
  presentation: MarketPresentation,
  line: number | null,
): OutcomeView[] {
  return [
    toOutcomeView(
      computed.over,
      "over",
      presentation,
      line,
      computed.recommended === "over",
    ),
    toOutcomeView(
      computed.under,
      "under",
      presentation,
      line,
      computed.recommended === "under",
    ),
  ];
}

// Forma N-vias canônica (ADR 0018): outcomes a partir de computeMarketScenarios.
// PURA — sem DB/catálogo. Exportada pra exercitar mercados N≥3 (ex.: 1X2 via
// fixture mock) antes da ativação no backend (Fase 4). over/under usa o caminho
// binário congelado (toBinaryOutcomes) por paridade; ambos passam por toOutcomeView.
export function toOutcomesView(
  result: { selections: ScenarioSelection[]; recommended: string | null },
  presentation: MarketPresentation,
  line: number | null,
): OutcomeView[] {
  return result.selections.map((s) =>
    toOutcomeView(s, s.key, presentation, line, s.key === result.recommended),
  );
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

  // Apresentação do mercado (labels/frases). Default over_under: o page/action
  // ainda não passa marketKey (#170 liga). `line` cai pra defaultLine do mercado.
  const presentation = getMarketPresentation(prediction.marketKey ?? "over_under");
  const line = prediction.line ?? presentation.defaultLine;

  // Ramificação por IDENTIDADE (#174): over_under fica no caminho binário
  // CONGELADO (computeScenarios/toBinaryOutcomes — hardcoded over/under, 100−x só
  // vale em N=2 sem push); TODO o resto (1X2 N=3, btts N=2) vai pro caminho N-vias
  // canônico (computeMarketScenarios → toOutcomesView, ADR 0018) — cada seleção
  // com seu próprio edge, SEM 100−x. O predicado é IDENTIDADE (marketKey ===
  // over_under), NUNCA length: over_under e btts são ambos N=2, então `length` não
  // os distingue — só a identidade mantém a paridade over/under byte-idêntica. É o
  // único branch de identidade permitido na view (espelha o guard de legacy-write
  // por OVER_UNDER em predict.ts). `recommendedKey` = a selectionKey escolhida ou
  // null em pass. N-vias não tem o framing de break-even binário (R4) → framing/note null.
  const isBinaryFrozen =
    (prediction.marketKey ?? "over_under") === "over_under";
  const isNway = !isBinaryFrozen && (prediction.selections?.length ?? 0) >= 2;

  // impliedSumTarget vem do descriptor (data-driven): 2 p/ dupla chance (cobertura
  // sobreposta), 1 (default) p/ partição (1X2, btts) — mantém o edge da grade
  // igual ao persistido pelo predict, que usa o mesmo fator.
  const impliedSumTarget =
    getDescriptor(prediction.marketKey ?? "over_under")?.impliedSumTarget ?? 1;
  const outcomesNway = isNway
    ? toOutcomesView(
        computeMarketScenarios({
          selections: prediction.selections!,
          recommendedKey: isPass ? null : recommendation,
          impliedSumTarget,
        }),
        presentation,
        line,
      )
    : null;

  // Computa o cenário binário UMA vez e alimenta o array multi-outcome
  // (outcomes) + framing/note — mesmos números, paridade trivial. Só no caminho
  // binário (≤2 seleções); em N-vias não há par congelado.
  const computed = isNway ? null : computeBinaryScenarios(prediction, confidenceNum);

  // framing/note no TOPO (R4): derivados do `computed` binário. Degrada pra null
  // junto com o bloco (computed null) e no caminho N-vias (sem análogo binário).
  const framingNote =
    computed === null
      ? { framing: null, note: null }
      : computeBinaryFramingNote(computed, presentation, line);

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
    recommendation: isPass
      ? null
      : {
          marketKey: presentation.marketKey,
          marketLabel: presentation.marketLabel,
          selectionKey: recommendation,
          selectionLabel: presentation.selectionLabel(recommendation),
          line,
          // Tradução leiga (lay-friendly): over/under → {market:"Mais de 2.5
          // gols", plain:"pelo menos 3 gols no jogo"}; 1X2 → {market:selectionLabel,
          // plain:""}. O componente renderiza a sub-linha só quando `plain` ≠ "".
          betSummary: presentation.betSummary(recommendation, line),
        },
    outcomes:
      outcomesNway ??
      (computed === null ? [] : toBinaryOutcomes(computed, presentation, line)),
    minOdd: prediction.minimumOdd !== null ? formatOdd(prediction.minimumOdd) : null,
    stakeUnits: isPass
      ? null
      : formatStakeUnits(prediction.stakeUnits ?? null),
    framing: framingNote.framing,
    note: framingNote.note,
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
