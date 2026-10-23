import { engineFromModelVersion } from "@/lib/ai/engine/analysis-engine";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { computeKellyStakeUnits } from "@/lib/ai/staking";
import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";
import {
  EV_ZERO_LABEL,
  formatAnalysisEngine,
  formatCostUsd,
  formatEdgePoints,
  formatEvPct,
  formatGeneratedAt,
  formatGeneratedAtSeconds,
  formatModelName,
  formatOdd,
  formatPct,
  formatRelativeAgoLabel,
  formatStakeUnits,
  formatTimeOfDay,
  modelIdFromVersion,
  roundOdd,
} from "@/lib/format";
import { formatLine } from "@/lib/format-number";
import {
  computeEvPerUnit,
  computeMarketScenarios,
  computeMinimumOdd,
  computeScenarios,
  MIN_EDGE_PP,
  type ScenarioSelection,
  type Scenarios,
  type ScenarioSide,
} from "@/lib/odds/scenario";
import { readLiveStamp } from "@/lib/live/stamp";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import { decidedOutcome } from "@/lib/quant/in-play";
import { liveStampLabel } from "@/lib/view/live-score";
import { ownsAiCall } from "@/lib/view/owns-ai-call";
import { getDisplayPresentation } from "@/lib/view/markets/display";
import type { MarketPresentation } from "@/lib/view/markets/presentation";
import type { TeamLabels } from "@/lib/view/markets/with-team-labels";
import type {
  AnalysisView,
  LineupRecheckView,
  MarketAnalysisSectionItem,
  OutcomeView,
  PreviousAnalysisItem,
  ScenarioSideView,
} from "@/lib/view/types";

// Aviso de risco ESTÁTICO da superfície de Análise/Recomendação sóbria (Report 05 rec. 4 /
// #434). Espelha PALPITE_DISCLAIMER (lib/view/palpites-headline.ts): rótulo fixo na cara do
// usuário, NÃO dado per-análise → constante de render (sem schema/migration). Renderizado
// como UMA linha muda: no rodapé de cada card (AnalysisResult) e uma vez no fan-out
// cross-mercado (BestBetResults). FIREWALL: esta é a superfície SÓBRIA onde edge/EV/stake/
// odd são SANCIONADOS (ADR 0030/0031) — a linha de risco NÃO passa por containsValueLanguage
// (o firewall só barra linguagem de valor da MANCHETE palpite, não da Análise). Copy: versão
// condensada de docs/ops/05-legal-compliance.md §3 pro card de análise.
export const ANALYSIS_RISK_DISCLAIMER =
  "Recomendação analítica, sem garantia de resultado. Aposte com responsabilidade." as const;

type PredictionInput = {
  // = key da seleção escolhida (qualquer mercado) ou "pass". `string` agnóstico
  // desde o contract (#179). isBinaryRecommendation estreita por VALOR (over/under/
  // pass) → over_under fica no caminho binário congelado; o resto vai pro N-vias.
  recommendation: string;
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
  // Rastro do motor code_jev (predictions.judgments, ADR 0041 §6): fonte do λ e falha
  // do JEV pro rodapé técnico. null/ausente no caminho LLM.
  judgments?: PredictionJudgments | null;
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
  // Ausente/≤2 → caminho binário congelado (over/under byte-idêntico). `label`
  // (nome do jogador, #290) viaja só pra mercados dynamicSelections — a view o
  // prefere ao presentation.selectionLabel(key) (que devolveria a key crua).
  // `modelProbPct` null = o modelo não estimou a seleção (artilheiro parcial, row
  // antiga sem prob): a grade mostra "—", nunca 0%.
  selections?: {
    key: string;
    modelProbPct: number | null;
    odd: number | null;
    label?: string;
  }[];
  // Leitura ao vivo (#594, ADR 0060): row com `is_live` e o carimbo cru (`live_state`,
  // lido por safeParse). Ausente = pré-jogo (byte-idêntico).
  isLive?: boolean;
  liveState?: unknown;
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

// Odd congelada fora do domínio do módulo puro (≤ 1, defensivo) degrada pra
// null — computeScenarios/computeEvPerUnit lançam pra entrada inválida; a view
// renderiza "—".
function toValidOdd(value: string | number | null): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 1 ? n : null;
}

function toScenarioSideView(side: ScenarioSide | ScenarioSelection): ScenarioSideView {
  const edge = formatEdgePoints(side.edgePct);
  return {
    modelProb: formatPct(side.modelProbPct),
    marketProb:
      side.impliedProbPct !== null ? formatPct(side.impliedProbPct) : "—",
    odd: side.odd !== null ? formatOdd(side.odd) : "—",
    edge: edge ?? "—",
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
    framing = `vantagens pequenas (abaixo de ${MIN_EDGE_PP} pontos) ficam dentro da margem de erro do modelo — por isso não há recomendação`;
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
// ScenarioSelection compartilham os campos numéricos, então serve aos dois caminhos
// (no N-vias a prob pode ser null: o modelo não estimou a seleção → "—").
function toOutcomeView(
  side: ScenarioSide | ScenarioSelection,
  key: string,
  presentation: MarketPresentation,
  line: number | null,
  isRecommended: boolean,
  // Label DINÂMICO (nome do jogador, #290) que sobrescreve presentation.*Label(key)
  // — pra mercados dynamicSelections onde a key (scorer_pedro) não é legível. Ausente
  // (partição) → presentation labels (byte-idêntico).
  dynamicLabel?: string,
): OutcomeView {
  const sv = toScenarioSideView(side);
  return {
    id: key,
    label: dynamicLabel ?? presentation.outcomeLabel(key, line),
    scenarioLabel: dynamicLabel ?? presentation.scenarioLabel(key, line),
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
  // Carrier com labels por seleção (#290 dynamicSelections): quando presente,
  // o label do jogador sobrescreve presentation.*Label(key). Ausente → byte-idêntico.
  labeledSelections?: { key: string; label?: string }[],
): OutcomeView[] {
  const labelByKey = labeledSelections
    ? new Map(labeledSelections.map((s) => [s.key, s.label]))
    : null;
  return result.selections.map((s) =>
    toOutcomeView(
      s,
      s.key,
      presentation,
      line,
      s.key === result.recommended,
      labelByKey?.get(s.key) ?? undefined,
    ),
  );
}

export function toAnalysisView(
  prediction: PredictionInput,
  aiCall: AiCallInput | null,
  now: Date = new Date(),
  // Fuso de exibição do usuário (#1) p/ o "gerado em". Undefined = runtime (legado).
  timeZone?: string,
  // Nome dos times nos rótulos do 1X2/dupla chance (#574). Ausente = "Casa"/"Fora".
  teams?: TeamLabels,
): AnalysisView {
  const recommendation = prediction.recommendation;
  const isPass = recommendation === "pass";
  const oddAtRecNum = toFiniteNumber(prediction.oddAtRecommendation);
  const confidenceNum = toFiniteNumber(prediction.confidencePct);

  // Apresentação do mercado (labels/frases). Default over_under: o page/action
  // ainda não passa marketKey (#170 liga). `line` cai pra defaultLine do mercado.
  const presentation = getDisplayPresentation(prediction.marketKey ?? "over_under", teams);
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
  // Leitura ao vivo (#594): sem odd, então sem o caminho binário congelado (que existe
  // pela paridade das rows antigas e cai fora quando um lado já está decidido, P=100).
  // Vai pro N-vias, que mostra só a prob. do modelo por seleção.
  const liveStamp = prediction.isLive ? readLiveStamp(prediction.liveState) : null;
  const liveLabel = prediction.isLive
    ? liveStamp
      ? liveStampLabel(liveStamp)
      : "ao vivo"
    : null;
  const isBinaryFrozen =
    liveLabel === null && (prediction.marketKey ?? "over_under") === "over_under";
  const isNway = !isBinaryFrozen && (prediction.selections?.length ?? 0) >= 2;

  // impliedSumTarget/marketKind vêm do descriptor (data-driven): 2 p/ dupla chance
  // (cobertura sobreposta), 1 (default) p/ partição; independent_binary (scorer)
  // usa a implícita-TETO (sem normalização). Mantém o edge da grade igual ao
  // persistido pelo predict, que usa os MESMOS fatores.
  const descriptor = getDescriptor(prediction.marketKey ?? "over_under");
  const impliedSumTarget = descriptor?.impliedSumTarget ?? 1;
  const marketKind = descriptor?.marketKind ?? "partition";
  // Piso de edge do mercado (C5): default 5 (partition) / 8 (scorer). Threadado pra
  // minEdgeLabel + a prop minEdgePp do AnalysisScenarios — a view nunca hardcoda 5
  // pra um mercado de piso 8.
  const minEdgePp = descriptor?.minEdgePp ?? MIN_EDGE_PP;
  const minOddNum = resolveMinOdd({
    prediction,
    recommendation: isPass || liveLabel !== null ? null : recommendation,
    oddAtRec: oddAtRecNum,
    minEdgePp,
    impliedSumTarget,
    marketKind,
  });
  const outcomesNway = isNway
    ? toOutcomesView(
        computeMarketScenarios({
          selections: prediction.selections!,
          recommendedKey: isPass ? null : recommendation,
          impliedSumTarget,
          marketKind,
        }),
        presentation,
        line,
        // Mercados dynamicSelections (scorer): a key crua (scorer_pedro) não é
        // legível — prefere o label threadado do DB (nome do jogador).
        descriptor?.dynamicSelections ? prediction.selections : undefined,
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
  // a tabela de mercados cobre as atuais). computeEvPerUnit exige odd > 1; valores fora
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
    const minOddLabel = formatOdd(minOddNum);
    // Aviso comparado na precisão de EXIBIÇÃO (formatOdd, 2 casas): o banco
    // guarda 3 casas, e uma diferença que some no arredondamento renderizaria
    // dois números iguais declarados desiguais — a contradição que o aviso
    // existe pra evitar. Usa o mesmo arredondamento do formatOdd (toFixed(2)),
    // sem reparsear a string formatada (que sai com vírgula, #574).
    const minOddAboveOddAtRec =
      minOddNum !== null &&
      oddAtRecNum !== null &&
      roundOdd(minOddNum) > roundOdd(oddAtRecNum);
    if (minOddAboveOddAtRec) {
      evLegend = `a odd registrada na análise (${formatOdd(oddAtRecNum)}) estava abaixo da mínima sugerida (${minOddLabel}) — só vale a pena se a odd subir para ≥ ${minOddLabel}`;
    } else if (evPerUnit !== null && evPerUnit <= 0) {
      evLegend = `na odd registrada na análise, o retorno esperado é negativo — só vale a pena com odd ≥ ${minOddLabel}`;
    } else if (evPerUnit !== null) {
      // evPerUnit > 0 aqui; tom positivo só se o sinal sobrevive ao
      // arredondamento de exibição — "0,0%" verde afirmaria direção que o
      // próprio número não mostra.
      if (formatEvPct(evPerUnit) !== EV_ZERO_LABEL) expectedReturnTone = "positive";
      evLegend = `ganho médio por aposta, no longo prazo, se a estimativa de ${formatPct(prediction.confidencePct)} do modelo estiver certa`;
    }
    // evPerUnit null (histórica degradada): retorno é "—", nenhuma legenda —
    // não explicar um número que não existe na tela.
  }

  // Label da seleção recomendada: mercados dynamicSelections (scorer) preferem o
  // nome do jogador threadado do DB; senão a apresentação (byte-idêntico).
  const recommendedDynamicLabel =
    descriptor?.dynamicSelections && !isPass
      ? prediction.selections?.find((s) => s.key === recommendation)?.label
      : undefined;
  const stakeUnits = isPass ? null : formatStakeUnits(prediction.stakeUnits ?? null);
  // Mesma p do Kelly oficial do predict (recModelProb = implícita + edge, as duas
  // gravadas), não a confiança: no motor llm a confiança pode divergir do prob_<rec>.
  // Só com p·odd > 1, porque computeKellyStakeUnits faz clamp no piso de 0.5u e um
  // f* ≤ 0 apareceria como sugestão de aposta. Some quando repete o stake oficial
  // (gate do Kelly ativo: o oficial já é o quarter-Kelly).
  const impliedNum = toFiniteNumber(prediction.impliedProbPct);
  const edgeNum = toFiniteNumber(prediction.edgePct);
  const kellyProb =
    isPass || impliedNum === null || edgeNum === null ? null : (impliedNum + edgeNum) / 100;
  const kellyRaw =
    kellyProb !== null && oddAtRecNum !== null && kellyProb * oddAtRecNum > 1
      ? formatStakeUnits(computeKellyStakeUnits(kellyProb, oddAtRecNum))
      : null;
  const kellyInfoUnits = kellyRaw !== stakeUnits ? kellyRaw : null;
  const valueNote =
    isPass || liveLabel !== null
      ? null
      : valueBetNote({
          modelProb: kellyProb,
          impliedPct: impliedNum,
          marketKind,
          recommendation,
          selections: prediction.selections,
        });

  // Reconferência com a escalação (#619): o "há X" da odd conta da captura usada, não da
  // gravação; com as odds congeladas da análise anterior, sem "há" (o aviso diz de onde).
  const lineupRecheck = toLineupRecheckView(prediction, presentation, line, timeZone);
  const recheckOdds = prediction.judgments?.recheck;
  const oddCapturedAt =
    lineupRecheck && recheckOdds?.oddsFrom === "snapshot" && recheckOdds.oddsCapturedAt
      ? new Date(recheckOdds.oddsCapturedAt)
      : null;
  const oddAtRecAgo = isPass
    ? null
    : lineupRecheck
      ? oddCapturedAt && Number.isFinite(oddCapturedAt.getTime())
        ? formatRelativeAgoLabel(oddCapturedAt, now)
        : null
      : formatRelativeAgoLabel(prediction.createdAt, now);

  return {
    recommendation: isPass
      ? null
      : {
          marketKey: presentation.marketKey,
          marketLabel: presentation.marketLabel,
          selectionKey: recommendation,
          selectionLabel:
            recommendedDynamicLabel ??
            presentation.selectionLabel(recommendation),
          line,
          // Tradução leiga (lay-friendly): over/under → {market:"Mais de 2.5
          // gols", plain:"pelo menos 3 gols no jogo"}; 1X2 → {market:selectionLabel,
          // plain:""}. O componente renderiza a sub-linha só quando `plain` ≠ "".
          // scorer (dynamicSelections): {market: nome do jogador, plain: ""}.
          betSummary: recommendedDynamicLabel
            ? { market: recommendedDynamicLabel, plain: "" }
            : presentation.betSummary(recommendation, line),
        },
    outcomes: markDecided(
      outcomesNway ??
        (computed === null ? [] : toBinaryOutcomes(computed, presentation, line)),
      liveLabel !== null && liveStamp?.score
        ? { kind: prediction.marketKey ?? "over_under", line, score: liveStamp.score }
        : null,
    ),
    minOdd: minOddNum !== null ? formatOdd(minOddNum) : null,
    stakeUnits,
    kellyInfoUnits,
    framing: framingNote.framing,
    note: framingNote.note,
    oddAtRec: isPass ? null : formatOdd(prediction.oddAtRecommendation),
    oddAtRecAgo,
    bookmaker: isPass ? null : prediction.bookmaker,
    expectedReturn: isPass ? null : formatEvPct(evPerUnit),
    expectedReturnTone,
    evLegend,
    // #290: piso de edge do MERCADO (descriptor.minEdgePp) — scorer mostra 8pp, não
    // a constante 5 hardcoded. Default 5 (partition) mantém over_under/correct_score
    // byte-idênticos. A view nunca "mente" o piso por mercado.
    minEdgeLabel: `${minEdgePp} pontos`,
    minEdgePp,
    rationale: prediction.rationale,
    factors: prediction.keyFactors,
    generatedAt: formatGeneratedAt(prediction.createdAt, timeZone),
    promptVersion: prediction.promptVersion,
    // Reconferência com a escalação (#619): o texto é templado em código, sem chamada
    // narradora; o modelVersion herdado do pai não narrou nada aqui.
    model:
      prediction.judgments?.narration === "lineup_recheck_template"
        ? LINEUP_RECHECK_MODEL_LABEL
        : formatModelName(prediction.modelVersion),
    engine: formatAnalysisEngine(prediction.modelVersion, prediction.judgments),
    costUsd: formatCostUsd(aiCall?.costUsd ?? null),
    ...(liveLabel !== null ? { liveLabel } : {}),
    ...(lineupRecheck ? { lineupRecheck } : {}),
    ...(valueNote !== null ? { valueNote } : {}),
  };
}

export const LINEUP_RECHECK_MODEL_LABEL = "texto automático";

// Odd mínima ("vale a pena se odd ≥"). No motor em código ela sai das odds congeladas
// pela mesma conta do predict (computeMinimumOdd), inclusive em rows antigas, que
// gravaram 100/(P − piso) contra 1/odd cru e pediam odd acima da própria análise. No
// LLM é a odd que o modelo declarou (ADR 0012), e a contradição com a odd da análise,
// quando aparece, é real.
function resolveMinOdd(args: {
  prediction: PredictionInput;
  recommendation: string | null;
  oddAtRec: number | null;
  minEdgePp: number;
  impliedSumTarget: number;
  marketKind: string;
}): number | null {
  const stored = toFiniteNumber(args.prediction.minimumOdd);
  const { prediction, recommendation } = args;
  const selections = prediction.selections;
  if (
    recommendation === null ||
    args.marketKind !== "partition" ||
    engineFromModelVersion(prediction.modelVersion) !== "code_jev" ||
    !selections ||
    selections.length < 2
  ) {
    return stored;
  }
  const modelProbPct = selections.find(
    (s) => s.key === recommendation
  )?.modelProbPct;
  if (modelProbPct == null) return stored;
  return (
    computeMinimumOdd({
      oddByKey: Object.fromEntries(selections.map((s) => [s.key, s.odd])),
      selectionKeys: selections.map((s) => s.key),
      key: recommendation,
      modelProbPct,
      minEdgePp: args.minEdgePp,
      impliedSumTarget: args.impliedSumTarget,
      oddAtRec: args.oddAtRec,
    }) ?? stored
  );
}

// Recomendação com prob. do modelo abaixo de 50%: é aposta de valor e perde mais vezes
// do que ganha. Quando outra seleção do mercado é mais provável pro modelo, ela também
// não é o resultado mais provável e pode ir contra o palpite (dupla chance "Empate ou
// Remo" com o palpite em 2–0 Cruzeiro); um 1X2 a 45% pode ser o favorito. Sem implícita
// (ao vivo, row antiga) não há o que comparar; artilheiro (implícita-teto) fica de fora.
function valueBetNote(args: {
  modelProb: number | null;
  impliedPct: number | null;
  marketKind: string;
  recommendation: string;
  selections: PredictionInput["selections"];
}): string | null {
  const { modelProb, impliedPct } = args;
  if (modelProb === null || impliedPct === null) return null;
  if (args.marketKind !== "partition") return null;
  const modelPct = modelProb * 100;
  if (modelPct >= 50) return null;
  const numbers = `o modelo dá ${formatPct(modelPct)} de chance e o mercado, ${formatPct(impliedPct)}`;
  const otherMoreLikely = (args.selections ?? []).some(
    (s) =>
      s.key !== args.recommendation &&
      s.modelProbPct !== null &&
      s.modelProbPct > modelPct,
  );
  return otherMoreLikely
    ? `Aposta de valor, não o resultado mais provável: ${numbers}. Perde mais vezes do que ganha, por isso pode ir contra o palpite; compensa no longo prazo se o modelo estiver certo.`
    : `Aposta de valor: ${numbers}. Perde mais vezes do que ganha; compensa no longo prazo se o modelo estiver certo.`;
}

// "Mais de 2,5" / "Vitória do Flamengo" / "sem aposta": o lado de uma recomendação pro
// "antes → agora" da reconferência. Mesmo rótulo do resumo da seção.
function recommendationLabel(
  presentation: MarketPresentation,
  recommendation: string,
  line: number | null,
): string {
  if (recommendation === "pass") return "sem aposta";
  const lineLabel = line !== null ? ` ${formatLine(line)}` : "";
  return `${presentation.selectionLabel(recommendation)}${lineLabel}`;
}

// Reconferência com a escalação (#619): lida do jsonb sem validação, então defensiva
// (row antiga ou parcial nunca derruba a view; sem marcador → null).
function toLineupRecheckView(
  prediction: PredictionInput,
  presentation: MarketPresentation,
  line: number | null,
  timeZone: string | undefined,
): LineupRecheckView | null {
  const recheck = prediction.judgments?.recheck;
  if (!recheck || recheck.kind !== "lineup" || !recheck.before) return null;
  const capturedAt =
    recheck.oddsFrom === "snapshot" && recheck.oddsCapturedAt
      ? new Date(recheck.oddsCapturedAt)
      : null;
  const before = recommendationLabel(
    presentation,
    recheck.before.recommendation,
    recheck.before.line,
  );
  const after = recommendationLabel(presentation, prediction.recommendation, line);
  return {
    at: formatTimeOfDay(prediction.createdAt, timeZone),
    oddsAt:
      capturedAt && Number.isFinite(capturedAt.getTime())
        ? formatTimeOfDay(capturedAt, timeZone)
        : null,
    before,
    after,
    changed: before !== after,
  };
}

// Leitura ao vivo (#594): marca a seleção que o placar já decidiu, pelo MESMO
// predicado do predictInPlay (`decidedOutcome`) sobre o placar do carimbo. Nunca pela
// prob. arredondada: um empate a 0,00% aos 88' com 3–0 não está decidido. Fora do ao
// vivo (ou carimbo sem placar), os outcomes passam intactos.
function markDecided(
  outcomes: OutcomeView[],
  live: {
    kind: string;
    line: number | null;
    score: { home: number; away: number };
  } | null,
): OutcomeView[] {
  if (live === null) return outcomes;
  return outcomes.map((o) =>
    decidedOutcome(live.kind, { line: live.line, selection: o.id }, live.score) !== null
      ? { ...o, decided: true }
      : o,
  );
}

// Adapta uma row do DB (PredictionWithAiCall — de getPredictionHistoryForMatch) pra
// AnalysisView. Centraliza a fiação multi-mercado (#170/#173) que antes vivia inline
// na match page, agora reusada pra cada SEÇÃO por-mercado (#243) e pra cada ANTERIOR
// (#204). marketId null (histórica sem backfill) → coalesce 'over_under'; `line` da
// forma salva (null em 1X2); candidate set → grade N-vias.
export function toAnalysisViewFromPrediction(
  row: PredictionWithAiCall,
  now: Date = new Date(),
  timeZone?: string,
  teams?: TeamLabels,
): AnalysisView {
  return toAnalysisView(
    {
      recommendation: row.prediction.recommendation,
      confidencePct: row.prediction.confidencePct,
      rationale: row.prediction.rationale,
      keyFactors: row.prediction.keyFactors,
      minimumOdd: row.prediction.minimumOdd,
      oddAtRecommendation: row.prediction.oddAtRecommendation,
      bookmaker: row.prediction.bookmaker,
      impliedProbPct: row.prediction.impliedProbPct,
      edgePct: row.prediction.edgePct,
      modelVersion: row.prediction.modelVersion,
      promptVersion: row.prediction.promptVersion,
      createdAt: row.prediction.createdAt,
      judgments: row.prediction.judgments,
      marketKey: row.marketKey ?? "over_under",
      line: row.prediction.marketParams?.line ?? null,
      stakeUnits: row.prediction.stakeUnits,
      selections: row.selections,
      isLive: row.prediction.isLive === true,
      liveState: row.prediction.liveState,
    },
    // Mercado não escolhido no best bet code_jev (#512): a ai_call é a narração de
    // outro card → sem custo aqui.
    row.aiCall && ownsAiCall(row.prediction)
      ? { costUsd: row.aiCall.costUsd }
      : null,
    now,
    timeZone,
    teams,
  );
}

// Última análise de CADA mercado de um jogo (#243): agrupa o histórico (já
// desc(createdAt), desc(id)) por mercado e devolve o 1º de cada bucket = a mais
// recente daquele mercado. A key do bucket é COALESCED (`marketKey ?? "over_under"`,
// igual a toAnalysisView/toPreviousAnalysisItems) — uma row sem mercado backfillado
// cai no MESMO bucket over_under, então um jogo com [over_under real + histórica null]
// vira UMA seção (o latest vence), nunca duas (AC4). Ordem das seções = primeira
// aparição em desc(createdAt) = mercado (re)analisado mais recentemente primeiro, o que
// alimenta `defaultOpen={i===0}` na seção colapsável (a mais recente abre). PURA.
//
// INVARIANTE p/ #243/#244: `sections.length` é a ÚNICA fonte de single-vs-multi —
// `<= 1` DEVE renderizar o AnalysisResult cru byte-idêntico ao atual (AC3).
//
// Pré-jogo e ao vivo NÃO se misturam (#594, PLAN-580 §11): `live: false` (default) =
// a última análise de PRÉ-JOGO de cada mercado (uma leitura ao vivo nunca a esconde);
// `live: true` = a última LEITURA AO VIVO de cada mercado, a seção "Leituras ao vivo".
export function toMarketAnalysisSections(
  history: PredictionWithAiCall[],
  now: Date = new Date(),
  timeZone?: string,
  teams?: TeamLabels,
  opts: { live?: boolean } = {},
): MarketAnalysisSectionItem[] {
  const wantLive = opts.live === true;
  const seen = new Set<string>();
  const sections: MarketAnalysisSectionItem[] = [];
  // Ordem das seções: a da última análise NÃO reconferida de cada mercado (#619). A
  // reconferência com a escalação é do cron, não um pedido do usuário: ela vira a
  // seção do mercado, mas não o puxa pro topo.
  const rank = new Map<string, number>();
  history.forEach((row, i) => {
    if ((row.prediction.isLive === true) !== wantLive) return;
    const marketKey = row.marketKey ?? "over_under";
    if (rank.has(marketKey) || row.prediction.judgments?.recheck) return;
    rank.set(marketKey, i);
  });
  for (const [i, row] of history.entries()) {
    if ((row.prediction.isLive === true) !== wantLive) continue;
    const marketKey = row.marketKey ?? "over_under";
    if (seen.has(marketKey)) continue;
    seen.add(marketKey);
    if (!rank.has(marketKey)) rank.set(marketKey, i);
    sections.push({
      id: row.prediction.id,
      // key React da seção (#244): estável na reanálise (a seção não remonta → o estado
      // do footer, ex. dropdown de modelo, persiste). Tb vai no hidden input do form de
      // reanálise por seção. Coalesced 'over_under' = mesmo bucket do agrupamento.
      marketKey,
      // marketLabel SIBLING da view (espelha PreviousAnalysisItem/BestBetEntry): o
      // branch pass do AnalysisResult não imprime mercado, então o título da seção o
      // identifica. Mesmo coalesce 'over_under' do bucket acima.
      marketLabel: getDisplayPresentation(marketKey).marketLabel,
      // modelVersion CRU (AIModelId) — semeia o dropdown do footer com o modelo que
      // rodou aquela análise (#244). initialModelOverride cai pro "default" se for um id
      // aposentado/fora-da-audiência (histórica), sem <option> órfã. Um id de versão
      // adotada (ADR 0062, `claude-sonnet-5-6`) vira a conferida da família lá
      // (resolveModelId), que é a opção do dropdown.
      modelId: modelIdFromVersion(row.prediction.modelVersion),
      view: toAnalysisViewFromPrediction(row, now, timeZone, teams),
    });
  }
  return sections.sort(
    (a, b) => (rank.get(a.marketKey) ?? 0) - (rank.get(b.marketKey) ?? 0),
  );
}

// Seção "análises anteriores" (#204): as predições que NÃO são a última de cada
// mercado (essas viram seção por-mercado, #243), da mais recente pra a mais antiga (a
// query já ordena desc(createdAt)). Pula o 1º de cada bucket coalesced — com 1 só
// mercado isso é exatamente `slice(1)` (idêntico ao #204), com N mercados exclui os N
// latests (que estão nas seções) sem duplicar. PURA + testável (sem DB/IO).
export function toPreviousAnalysisItems(
  history: PredictionWithAiCall[],
  now: Date = new Date(),
  timeZone?: string,
  teams?: TeamLabels,
): PreviousAnalysisItem[] {
  const seen = new Set<string>();
  const items: PreviousAnalysisItem[] = [];
  for (const row of history) {
    const marketKey = row.marketKey ?? "over_under";
    // 1ª aparição do mercado = a última análise dele (vira seção, #243) → não é
    // "anterior". As demais (reanálises mais antigas) entram aqui. O bucket separa
    // pré-jogo de ao vivo (#594): cada lado tem a sua seção.
    const bucket = `${row.prediction.isLive === true ? "live" : "pre"}:${marketKey}`;
    if (!seen.has(bucket)) {
      seen.add(bucket);
      continue;
    }
    items.push({
      id: row.prediction.id,
      // marketLabel SEPARADO da view: o branch pass do AnalysisResult não imprime
      // mercado, então o header o identifica (AC3). Mesmo coalesce 'over_under'.
      marketLabel: getDisplayPresentation(marketKey).marketLabel,
      generatedAt: formatGeneratedAtSeconds(row.prediction.createdAt, timeZone),
      view: toAnalysisViewFromPrediction(row, now, timeZone, teams),
    });
  }
  return items;
}

export const PALPITE_BEFORE_LINEUP_NOTICE = "Palpite gerado antes da escalação.";

/**
 * Aviso de uma linha do HERO (#619): há reconferência com a escalação mais nova que o
 * palpite exibido (o palpite foi sintetizado sobre análises que a escalação já
 * atualizou). Só texto, sem número (firewall da ADR 0030). Só no pré-jogo: depois do
 * apito o aviso não leva a nada. null fora do pré-jogo, sem palpite ou sem
 * reconferência mais nova.
 */
export function palpiteBeforeLineupNotice(
  history: readonly Pick<PredictionWithAiCall, "prediction">[],
  palpiteCreatedAt: Date | null,
  preMatch: boolean,
): string | null {
  if (!preMatch || palpiteCreatedAt === null) return null;
  const newer = history.some(
    (r) =>
      r.prediction.isLive !== true &&
      r.prediction.judgments?.recheck?.kind === "lineup" &&
      r.prediction.createdAt.getTime() > palpiteCreatedAt.getTime(),
  );
  return newer ? PALPITE_BEFORE_LINEUP_NOTICE : null;
}
