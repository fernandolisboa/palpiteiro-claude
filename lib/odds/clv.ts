// CLV (closing line value) — métrica-companheira do Yield (#180). Funções PURAS,
// computadas read-time: comparam a odd na recomendação com a odd de FECHAMENTO
// (closing line — o último snapshot capturado perto do kickoff).
//
// Convenção de sinal (load-bearing): **positivo = bateu o fechamento (BOM)** nas
// DUAS métricas. Você quer ter pego um preço melhor do que o mercado fechou.
//   - CLV% (razão de odds): oddRec > oddClose ⟹ peguei odd maior ⟹ +.
//   - Δ no-vig (pp): a prob no-vig de fechamento do seu lado SUBIU vs a prob
//     implícita na recomendação ⟹ o mercado concordou mais com você ⟹ +.
//
// Convenção de bookmaker (intencional, documentar na UI): a odd da recomendação é
// o MELHOR book no momento da análise; a odd de fechamento é o MELHOR book no
// fechamento — podem ser casas diferentes. É "seu melhor preço vs melhor preço de
// fechamento", NÃO house-vs-house. É o sinal honesto de "bati o mercado".
//
// Todas as funções são DEFENSIVAS: entrada faltante/inválida (null, não-finita,
// odd ≤ 1, overround incoerente) → `null`, NUNCA throw (rodam no render do
// dashboard). Drizzle numeric volta string: o caller faz Number() no boundary; aqui
// só number|null|undefined entram. [[drizzle-numeric-returns-string]]

export type ClvResult = {
  /** CLV razão-de-odds em % (sinalizado; + = bateu o fechamento). null sem insumo. */
  oddsRatioPct: number | null;
  /** CLV delta de prob no-vig em pontos percentuais (+ = bateu o fechamento). null sem insumo. */
  noVigDeltaPp: number | null;
};

type Num = number | null | undefined;

function asOdd(v: Num): number | null {
  // Odds válidas são finitas e > 1 (espelha assertValidOdd de implied-probability.ts).
  return typeof v === "number" && Number.isFinite(v) && v > 1 ? v : null;
}

function asFinite(v: Num): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * CLV razão de odds (%): `(oddRec / oddClose − 1) × 100`. + = peguei preço melhor
 * que o fechamento. Precisa só de oddRec + oddClose válidas.
 */
export function clvOddsRatioPct(oddRec: Num, oddClose: Num): number | null {
  const rec = asOdd(oddRec);
  const close = asOdd(oddClose);
  if (rec === null || close === null) return null;
  return (rec / close - 1) * 100;
}

/**
 * Probabilidade NO-VIG (%) de uma seleção a partir da sua odd e do overround do
 * MERCADO COMPLETO (overroundPct = (Σ1/odd − 1)×100, FRAÇÃO×100; ver
 * implied-probability.ts / select-bookmaker.ts). Σ = 1 + overroundPct/100, então:
 *   noVigProb = ((1/odd) / Σ) × 100 × impliedSumTarget
 * `impliedSumTarget` vem do descriptor (1 p/ partição: over/under, 1X2; 2 p/ dupla
 * chance — ADR 0018). Mesma fórmula que predict.ts grava em predictions.impliedProbPct,
 * o que torna o delta abaixo apples-to-apples.
 */
export function noVigProbPct(
  odd: Num,
  overroundPct: Num,
  impliedSumTarget: Num,
): number | null {
  const o = asOdd(odd);
  const op = asFinite(overroundPct);
  if (o === null || op === null) return null;
  const sum = 1 + op / 100; // Σ = Σ_i (1/odd_i)
  if (!(sum > 0)) return null;
  const target = asFinite(impliedSumTarget) ?? 1;
  return (1 / o / sum) * 100 * target;
}

/**
 * CLV delta no-vig (pp): `probNoVigClose − recImpliedPct`. + = a prob de fechamento
 * do seu lado ficou maior que a implícita na recomendação (mercado veio na sua
 * direção). `recImpliedPct` = predictions.impliedProbPct (já no-vig ×impliedSumTarget×100).
 * null se faltar qualquer insumo (ex.: impliedProbPct null em rows antigas).
 */
export function clvNoVigDeltaPp(
  recImpliedPct: Num,
  oddClose: Num,
  overroundPctClose: Num,
  impliedSumTarget: Num,
): number | null {
  const rec = asFinite(recImpliedPct);
  const close = noVigProbPct(oddClose, overroundPctClose, impliedSumTarget);
  if (rec === null || close === null) return null;
  return close - rec;
}

/**
 * Conveniência: as DUAS métricas de CLV de uma predição non-pass com closing line.
 * Cada uma é null INDEPENDENTE (a razão-de-odds só precisa das odds; o delta no-vig
 * precisa também de recImpliedPct + overround do fechamento).
 */
export function computeClv(input: {
  oddRec: Num;
  oddClose: Num;
  overroundPctClose: Num;
  recImpliedPct: Num;
  impliedSumTarget: Num;
}): ClvResult {
  return {
    oddsRatioPct: clvOddsRatioPct(input.oddRec, input.oddClose),
    noVigDeltaPp: clvNoVigDeltaPp(
      input.recImpliedPct,
      input.oddClose,
      input.overroundPctClose,
      input.impliedSumTarget,
    ),
  };
}
