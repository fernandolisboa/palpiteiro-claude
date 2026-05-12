export type Overround = number;

export type ImpliedProbabilities = {
  overProb: number;
  underProb: number;
  overround: Overround;
};

function assertValidOdd(label: string, odd: number): void {
  if (!Number.isFinite(odd) || odd <= 1) {
    throw new Error(`Invalid ${label} odd: ${odd} (must be finite and > 1)`);
  }
}

// Normaliza probabilidades implícitas descontando o overround embutido no
// mercado. Útil pra comparar com a probabilidade estimada pelo modelo e
// calcular o edge real. Fórmulas:
//   raw_x = 1/odd_x
//   sum = raw_over + raw_under
//   overround = sum - 1
//   prob_x = raw_x / sum    (normalizada — soma 1)
export function computeImpliedProbabilities(
  overOdd: number,
  underOdd: number,
): ImpliedProbabilities {
  assertValidOdd("over", overOdd);
  assertValidOdd("under", underOdd);
  const rawOver = 1 / overOdd;
  const rawUnder = 1 / underOdd;
  const sum = rawOver + rawUnder;
  return {
    overProb: rawOver / sum,
    underProb: rawUnder / sum,
    overround: sum - 1,
  };
}
