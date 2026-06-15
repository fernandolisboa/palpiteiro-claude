export type Overround = number;

export type MarketImpliedProbabilities = {
  probs: number[];
  overround: Overround;
};

function assertValidOdd(label: string, odd: number): void {
  if (!Number.isFinite(odd) || odd <= 1) {
    throw new Error(`Invalid ${label} odd: ${odd} (must be finite and > 1)`);
  }
}

// Core canônico N-ário (ADR 0018, decisão 1): normaliza as probabilidades
// implícitas de um mercado de N seleções descontando o overround embutido.
// O over/under (N=2) é só um caso particular deste core (sem wrapper binário
// dedicado desde a Fase 5 — os callers passam [overOdd, underOdd]).
// Fórmulas:
//   raw_i = 1/odds[i]
//   sum = Σ_i raw_i
//   overround = sum - 1    (FRAÇÃO, não percentual; ver ADR 0018 / call sites)
//   probs_i = raw_i / sum  (normalizada — Σ_i probs_i = 1)
// overround só faz sentido pra N ≥ 2 (o menor mercado real); callers não
// devem lê-lo com N < 2.
export function computeMarketImpliedProbabilities(
  odds: number[],
): MarketImpliedProbabilities {
  if (odds.length === 0) {
    throw new Error("Invalid market: odds array must not be empty");
  }
  odds.forEach((odd, i) => assertValidOdd(String(i), odd));
  const raw = odds.map((odd) => 1 / odd);
  const sum = raw.reduce((a, b) => a + b, 0);
  return {
    probs: raw.map((r) => r / sum),
    overround: sum - 1,
  };
}

