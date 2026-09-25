import { computeMatchLambdas } from "@/lib/providers/sports-data/match-lambdas";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import {
  scorelineMatrix,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

// Fonte de λ + matriz de placar do motor code_jev (ADR 0041 §1). Mesmo shape que o
// `getModelScoreline` de `lib/quant/match-model.ts` (thread da Fase C, ADR 0039) vai
// expor. Quando ele existir, este corpo vira UMA linha delegando pra ele — o motor e o
// predict só conhecem esta função.
export type ModelScoreline = {
  source: "dixon_coles" | "heuristic";
  degraded: boolean;
  lambdaHome: number;
  lambdaAway: number;
  // ρ usado na matriz. Ausente = DIXON_COLES_RHO pinado de scorelineMatrix.
  rho?: number;
  matrix: ScorelineMatrix;
};

export type ModelScorelineArgs = {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
};

// Hoje só o caminho heurístico (Poisson da tabela, ADR 0037): o DC precisa do
// histórico de resultados, que o predict não carrega. null = tabela indisponível ou
// degenerada → o motor não precifica e o predict cai no caminho LLM.
export function resolveModelScoreline(
  args: ModelScorelineArgs
): ModelScoreline | null {
  const lambdas = computeMatchLambdas(args);
  if (!lambdas) return null;
  return {
    source: "heuristic",
    degraded: lambdas.degradedData,
    lambdaHome: lambdas.lambdaHome,
    lambdaAway: lambdas.lambdaAway,
    matrix: scorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway),
  };
}
