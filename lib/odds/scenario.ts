import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

// Threshold de edge do prompt over_under_v1.x, exposto pra UI não hardcodear.
// Sincronia pinada por teste server-side (lib/ai/__tests__/request-builder.test.ts):
// SYSTEM_PROMPT.includes(`${MIN_EDGE_PP} pontos percentuais`).
// NUNCA mover pra lib/ai/prompts/ — components/analysis-result.tsx é alcançável
// pelo client component AnalysisPanel ("use client"); importar de lib/ai/prompts
// lá embarcaria o SYSTEM_PROMPT (admin-only) no bundle JS do cliente.
export const MIN_EDGE_PP = 5;

function assertValidOdd(odd: number): void {
  if (!Number.isFinite(odd) || odd <= 1) {
    throw new Error(`Invalid odd: ${odd} (must be finite and > 1)`);
  }
}

// Retorno esperado por unidade apostada (fração): (modelProbPct/100) × odd − 1.
// Usa a odd CRUA de propósito — o payout bruto é o que paga o apostador; não
// confundir com a probabilidade implícita normalizada (lib/odds/implied-probability.ts),
// que serve pro cálculo de edge. Ex.: computeEvPerUnit(58, 1.92) → 0.1136.
export function computeEvPerUnit(modelProbPct: number, odd: number): number {
  assertValidOdd(odd);
  return (modelProbPct / 100) * odd - 1;
}

// Probabilidade REAL mínima (0-100) pra EV ≥ 0 na odd dada: 100/odd —
// deliberadamente 1/odd CRU. NÃO é a probabilidade implícita normalizada de
// computeMarketImpliedProbabilities (que desconta o overround e serve pro edge):
// quem paga o apostador é o payout bruto da odd, então o ponto de equilíbrio
// é contra a odd crua. NÃO "corrigir" pra versão normalizada — quebraria a
// matemática do break-even (ADR 0012, decisão 6).
export function computeBreakEvenProbPct(odd: number): number {
  assertValidOdd(odd);
  return 100 / odd;
}

// Odd decimal mínima pra EV ≥ 0 SE a probabilidade estimada pelo modelo
// estiver certa: 100/modelProbPct. Distinta da minimum_odd do LLM, que embute
// a margem de 5pp do prompt (ADR 0012, decisão 6). Derivável só da confidence
// — funciona inclusive em predições históricas sem odds congeladas.
export function computeModelBreakEvenOdd(modelProbPct: number): number {
  if (
    !Number.isFinite(modelProbPct) ||
    modelProbPct <= 0 ||
    modelProbPct > 100
  ) {
    throw new Error(
      `Invalid modelProbPct: ${modelProbPct} (must be finite and in (0, 100])`,
    );
  }
  return 100 / modelProbPct;
}

// Edge por seleção em pontos percentuais (ADR 0018, decisão 2): model − implied.
// A implícita é a NORMALIZADA pelo overround do mercado completo (não a crua).
// NÃO existe edge_oposto = −edge fora de N=2 — cada seleção tem o seu.
export function computeSelectionEdgePp(
  modelProbPct: number,
  impliedProbPct: number,
): number {
  return modelProbPct - impliedProbPct;
}

// Uma seleção no cenário N-ário (ADR 0018, decisão 4). impliedProbPct/edgePct
// são null quando o mercado não pode ser normalizado (alguma odd ausente);
// modelBreakEvenOdd (100/modelProbPct) é null quando modelProbPct ≤ 0 — uma
// seleção pode chegar com prob 0 (MatchResultOutputSchema permite, e o backfill
// histórico coalesce null→0), e 100/0 não existe.
export type ScenarioSelection = {
  key: string;
  modelProbPct: number;
  impliedProbPct: number | null;
  odd: number | null;
  edgePct: number | null; // modelProbPct − impliedProbPct (normalizada)
  evPerUnit: number | null; // null quando odd ausente; odd CRUA quando presente
  breakEvenProbPct: number | null; // 100/odd cru; null quando odd ausente
  modelBreakEvenOdd: number | null; // 100/modelProbPct; null quando modelProbPct ≤ 0
};

// Cenários multi-outcome canônicos (ADR 0018, decisão 4), forma N-vias da qual
// o binário computeScenarios é um caso particular (a ser unificado em #170).
// PURA dos inputs (model probs + odds), sem DB/LLM.
//
// recommendedKey é ECHO/PASS-THROUGH: o gatilho edge ≥ MIN_EDGE_PP é do
// LLM/prompt (ADR 0018 decisão 2), espelhando como computeScenarios repassa
// input.recommendation. Esta função NÃO deriva a recomendação dos edges.
//
// Implícita/edge: SÓ quando TODAS as odds estão presentes o mercado pode ser
// normalizado (Σraw completo) — daí implied_i via computeMarketImpliedProbabilities
// e edge_i = model_i − implied_i. Se QUALQUER odd faltar, implied/edge de TODAS
// as seleções viram null (mercado parcial não normaliza). EV/break-even saem da
// odd CRUA por seleção (ADR 0018 decisão 3). SEM 100−x em nenhum ponto.
export function computeMarketScenarios(input: {
  selections: { key: string; modelProbPct: number; odd: number | null }[];
  recommendedKey: string | null;
  // Soma-alvo da implícita (ADR 0018 + emenda não-partição). Default 1 (partição:
  // over/under, 1X2 — Σ implied = 1, byte-idêntico ao anterior). >1 p/ mercados de
  // cobertura sobreposta (dupla chance = 2): escala a normalização Σ=1 do core, de
  // modo que a implícita exibida e o edge da grade casem com os PERSISTIDOS pelo
  // predict (que usa o MESMO impliedSumTarget do descriptor). Sem isso, a view
  // re-derivaria Σ=1 e mostraria edge divergente do salvo (inaceitável).
  impliedSumTarget?: number;
}): { selections: ScenarioSelection[]; recommended: string | null } {
  const sumTarget = input.impliedSumTarget ?? 1;
  const allOddsPresent = input.selections.every((s) => s.odd !== null);
  const impliedByIndex = allOddsPresent
    ? computeMarketImpliedProbabilities(
        input.selections.map((s) => s.odd as number),
      ).probs.map((p) => p * 100 * sumTarget)
    : null;

  const selections = input.selections.map((s, i): ScenarioSelection => {
    const impliedProbPct = impliedByIndex !== null ? impliedByIndex[i] : null;
    return {
      key: s.key,
      modelProbPct: s.modelProbPct,
      impliedProbPct,
      odd: s.odd,
      edgePct:
        impliedProbPct !== null
          ? computeSelectionEdgePp(s.modelProbPct, impliedProbPct)
          : null,
      evPerUnit: s.odd !== null ? computeEvPerUnit(s.modelProbPct, s.odd) : null,
      breakEvenProbPct: s.odd !== null ? computeBreakEvenProbPct(s.odd) : null,
      // computeModelBreakEvenOdd lança pra modelProbPct ≤ 0 (contrato de odd > 1
      // do caminho binário). Em N-vias uma seleção pode ter prob 0 (schema permite,
      // backfill coalesce null→0) — degrada pra null como evPerUnit/breakEvenProbPct,
      // sem derrubar a view N-vias.
      modelBreakEvenOdd:
        s.modelProbPct > 0 ? computeModelBreakEvenOdd(s.modelProbPct) : null,
    };
  });

  return { selections, recommended: input.recommendedKey };
}

export type ScenarioSide = {
  modelProbPct: number;
  impliedProbPct: number | null;
  odd: number | null;
  edgePct: number | null; // modelProbPct − impliedProbPct
  evPerUnit: number | null; // null quando odd ausente (histórica)
  breakEvenProbPct: number | null; // 100/odd cru; null quando odd ausente
  // 100/modelProbPct. No caminho binário modelProbPct vem de computeScenarios, que
  // valida confidence em (0, 100) → sempre derivável; o tipo só é `| null` por
  // compatibilidade estrutural com ScenarioSelection (toScenarioSideView serve aos
  // dois caminhos), onde uma seleção pode chegar com prob 0.
  modelBreakEvenOdd: number | null;
};

export type Scenarios = {
  over: ScenarioSide;
  under: ScenarioSide;
  recommended: "over" | "under" | null;
};

// Cenários dos dois lados a partir dos valores CONGELADOS da prediction.
//
// Precedência (a regra mais importante do módulo):
// 1. O lado recomendado usa SEMPRE os valores armazenados na row
//    (oddAtRecommendation / impliedProbPct / edgePct) — nunca recomputar
//    quando o salvo existe: o edgePct salvo é .toFixed(2) e o recomputado das
//    odds .toFixed(3) divergem por arredondamento (ex.: salvo 7.35 → "+7.3";
//    recomputado 7.3506 → "+7.4") — dois "edge" diferentes pro MESMO lado na
//    MESMA tela é inaceitável.
// 2. O lado oposto deriva dos armazenados quando existem:
//    implied = 100 − impliedProbPct(salvo); edge = −edgePct(salvo).
// 3. O par congelado overOdd/underOdd fornece odd/EV/break-even do lado
//    oposto; SÓ em pass (implied/edge salvos são null por construção) a
//    implied dos DOIS lados é recomputada via computeMarketImpliedProbabilities e
//    os edges saem de modelProb − implied.
// 4. modelBreakEvenOdd = 100/modelProbPct nos dois lados, sempre.
// 5. O que não for derivável fica null (UI renderiza "—").
//
// A forma canônica de cenários agora é N-vias (computeMarketScenarios acima,
// ADR 0018 decisão 5): cada seleção tem implícita/edge próprios, SEM 100−x.
// A derivação 100−x do lado oposto AQUI no computeScenarios binário é um
// adaptador de VIEW legado DELIBERADO pros valores .toFixed(2) congelados na
// row — vale só porque a linha 2.5 nunca dá push (gols inteiros, ADR 0003) e
// fica retido até #170 migrar a view pro contrato N-vias. NÃO é caminho N-ário
// vivo nem esquecimento; quebraria com linhas inteiras (push devolve o stake).
//
// Convenção de confidencePct em pass (= prob do OVER, espelhando o schema de
// output do LLM) é tratada AQUI, num único lugar testado, não em componente.
export function computeScenarios(input: {
  recommendation: "over" | "under" | "pass";
  confidencePct: number; // em pass = prob do OVER (convenção do schema)
  oddAtRecommendation: number | null; // valores congelados já existentes na row
  impliedProbPct: number | null;
  edgePct: number | null;
  overOdd: number | null; // colunas novas; null em históricas
  underOdd: number | null;
}): Scenarios {
  if (
    !Number.isFinite(input.confidencePct) ||
    input.confidencePct <= 0 ||
    input.confidencePct >= 100
  ) {
    throw new Error(
      `Invalid confidencePct: ${input.confidencePct} (must be finite and in (0, 100))`,
    );
  }

  const recommended =
    input.recommendation === "pass" ? null : input.recommendation;

  const overModelProb =
    input.recommendation === "under"
      ? 100 - input.confidencePct
      : input.confidencePct;
  const underModelProb = 100 - overModelProb;

  // Odd por lado: o salvo do lado recomendado SEMPRE vence o par congelado
  // (precedência 1); o lado oposto (e pass) vem do par congelado.
  let overOdd = input.overOdd;
  let underOdd = input.underOdd;
  if (recommended === "over") overOdd = input.oddAtRecommendation ?? overOdd;
  if (recommended === "under") underOdd = input.oddAtRecommendation ?? underOdd;

  let overImplied: number | null = null;
  let underImplied: number | null = null;
  let overEdge: number | null = null;
  let underEdge: number | null = null;
  if (recommended === "over") {
    overImplied = input.impliedProbPct;
    overEdge = input.edgePct;
    underImplied =
      input.impliedProbPct !== null ? 100 - input.impliedProbPct : null;
    underEdge = input.edgePct !== null ? -input.edgePct : null;
  } else if (recommended === "under") {
    underImplied = input.impliedProbPct;
    underEdge = input.edgePct;
    overImplied =
      input.impliedProbPct !== null ? 100 - input.impliedProbPct : null;
    overEdge = input.edgePct !== null ? -input.edgePct : null;
  } else if (input.overOdd !== null && input.underOdd !== null) {
    // Pass: não há valores salvos — recomputa a implied normalizada do par
    // congelado (única recomputação permitida; precedência 3). Core N-ário com
    // [over, under]: probs[0]/probs[1] (bit-exato com o wrapper binário removido).
    const { probs } = computeMarketImpliedProbabilities([
      input.overOdd,
      input.underOdd,
    ]);
    overImplied = probs[0] * 100;
    underImplied = probs[1] * 100;
    overEdge = overModelProb - overImplied;
    underEdge = underModelProb - underImplied;
  }

  return {
    over: buildSide(overModelProb, overOdd, overImplied, overEdge),
    under: buildSide(underModelProb, underOdd, underImplied, underEdge),
    recommended,
  };
}

function buildSide(
  modelProbPct: number,
  odd: number | null,
  impliedProbPct: number | null,
  edgePct: number | null,
): ScenarioSide {
  return {
    modelProbPct,
    impliedProbPct,
    odd,
    edgePct,
    evPerUnit: odd !== null ? computeEvPerUnit(modelProbPct, odd) : null,
    breakEvenProbPct: odd !== null ? computeBreakEvenProbPct(odd) : null,
    modelBreakEvenOdd: computeModelBreakEvenOdd(modelProbPct),
  };
}
