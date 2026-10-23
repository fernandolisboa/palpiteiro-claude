import { p1X2, type ScorelineMatrix } from "@/lib/quant/scoreline-model";

import type { MarketAnalysisSummary } from "./synthesis-input";

// Confiança do palpite calculada pelo motor (#649, ADR 0069): a chance que o modelo
// estatístico dá ao RESULTADO (casa/empate/fora) do placar provável, em faixas fixas. O
// LLM não escolhe mais o rótulo. O número fica no jsonb (calibração); a view mostra só a
// palavra (firewall ADR 0030).

export type PalpiteConfidenceLevel = "baixa" | "media" | "alta";
export type MatchOutcome = "home" | "draw" | "away";
// Pontos percentuais (0..100), Σ = 100.
export type MatchResultProbs = Record<MatchOutcome, number>;

// De onde veio a probabilidade:
// - snapshot: a base do modelo por jogo (ADR 0052), a mesma pra todo usuário;
// - analysis: a análise de 1X2 do motor code_jev que alimentou o palpite (sem base);
// - live_matrix: a matriz do placar final do modelo em jogo (#580).
export type PalpiteConfidenceSource = "snapshot" | "analysis" | "live_matrix";

// P do resultado em pp, limites inclusivos: ≥ 40 é média, ≥ 55 é alta. Um empate quase
// nunca passa de 33% antes do jogo, então palpite de empate sai "baixa", e é isso mesmo.
export const PALPITE_CONFIDENCE_BANDS = { media: 40, alta: 55 } as const;

const OUTCOMES: readonly MatchOutcome[] = ["home", "draw", "away"];

export function scoreOutcome(score: { home: number; away: number }): MatchOutcome {
  if (score.home > score.away) return "home";
  if (score.home < score.away) return "away";
  return "draw";
}

export function confidenceLevel(probPct: number): PalpiteConfidenceLevel {
  if (probPct >= PALPITE_CONFIDENCE_BANDS.alta) return "alta";
  if (probPct >= PALPITE_CONFIDENCE_BANDS.media) return "media";
  return "baixa";
}

// Normaliza a Σ = 100 (qualquer escala de entrada). null em valor faltando, negativo,
// não finito ou soma zero.
function normalized(
  raw: Partial<Record<MatchOutcome, number | null | undefined>>,
): MatchResultProbs | null {
  const values = OUTCOMES.map((k) => raw[k]);
  if (
    values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)
  ) {
    return null;
  }
  const [home, draw, away] = values as number[];
  const sum = home + draw + away;
  if (!(sum > 0)) return null;
  return {
    home: (home / sum) * 100,
    draw: (draw / sum) * 100,
    away: (away / sum) * 100,
  };
}

export function matchResultProbs(
  probs: { home: number; draw: number; away: number } | null | undefined,
): MatchResultProbs | null {
  return probs ? normalized(probs) : null;
}

// A análise de 1X2 do motor code_jev entre as que alimentaram o palpite. A do motor LLM
// não serve: seria o LLM escolhendo a confiança de novo, um passo atrás.
export function matchResultProbsFromAnalyses(
  analyses: readonly Pick<MarketAnalysisSummary, "marketKey" | "engine" | "selections">[],
): MatchResultProbs | null {
  const analysis = analyses.find(
    (a) => a.marketKey === "match_result" && a.engine === "code_jev",
  );
  if (!analysis) return null;
  return normalized(
    Object.fromEntries(analysis.selections.map((s) => [s.key, s.modelProbPct])),
  );
}

export function matchResultProbsFromMatrix(
  matrix: ScorelineMatrix,
): MatchResultProbs | null {
  return normalized(p1X2(matrix));
}

export type ConfidenceProbs = {
  values: MatchResultProbs;
  source: PalpiteConfidenceSource;
};

// Pré-jogo: a base do modelo por jogo primeiro (a mesma pra todo usuário, sem o
// contexto extra de ninguém); sem base, a análise de 1X2 do code_jev do próprio run.
export function pregameConfidenceProbs(
  snapshot: { probabilities: { match_result: { home: number; draw: number; away: number } } } | null,
  analyses: Parameters<typeof matchResultProbsFromAnalyses>[0],
): ConfidenceProbs | null {
  const fromSnapshot = matchResultProbs(snapshot?.probabilities.match_result);
  if (fromSnapshot) return { values: fromSnapshot, source: "snapshot" };
  const fromAnalysis = matchResultProbsFromAnalyses(analyses);
  return fromAnalysis ? { values: fromAnalysis, source: "analysis" } : null;
}

// Ao vivo: a matriz do placar final do modelo em jogo (a mesma das leituras ao vivo).
export function liveConfidenceProbs(matrix: ScorelineMatrix): ConfidenceProbs | null {
  const values = matchResultProbsFromMatrix(matrix);
  return values ? { values, source: "live_matrix" } : null;
}

export type PalpiteConfidence = {
  level: PalpiteConfidenceLevel;
  // P do resultado do placar provável, pp com 2 casas.
  probPct: number;
  source: PalpiteConfidenceSource;
};

export function palpiteConfidence(
  probableScore: { home: number; away: number },
  probs: ConfidenceProbs | null,
): PalpiteConfidence | null {
  if (!probs) return null;
  const probPct = Number(probs.values[scoreOutcome(probableScore)].toFixed(2));
  return { level: confidenceLevel(probPct), probPct, source: probs.source };
}
