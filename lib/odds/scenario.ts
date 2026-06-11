import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";

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
// computeImpliedProbabilities (que desconta o overround e serve pro edge):
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

export type ScenarioSide = {
  modelProbPct: number;
  impliedProbPct: number | null;
  odd: number | null;
  edgePct: number | null; // modelProbPct − impliedProbPct
  evPerUnit: number | null; // null quando odd ausente (histórica)
  breakEvenProbPct: number | null; // 100/odd cru; null quando odd ausente
  modelBreakEvenOdd: number; // 100/modelProbPct — sempre derivável
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
//    implied dos DOIS lados é recomputada via computeImpliedProbabilities e
//    os edges saem de modelProb − implied.
// 4. modelBreakEvenOdd = 100/modelProbPct nos dois lados, sempre.
// 5. O que não for derivável fica null (UI renderiza "—").
//
// Premissa binária: P(lado oposto) = 100 − P(lado) vale porque a linha 2.5
// nunca dá push (gols são inteiros — ADR 0003). Quebraria com linhas inteiras
// futuras (push devolve o stake); revisar se outro mercado entrar.
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
    // congelado (única recomputação permitida; precedência 3).
    const implied = computeImpliedProbabilities(input.overOdd, input.underOdd);
    overImplied = implied.overProb * 100;
    underImplied = implied.underProb * 100;
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
