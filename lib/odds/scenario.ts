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
