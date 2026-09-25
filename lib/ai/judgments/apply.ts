import type { MatchLambdas } from "@/lib/providers/sports-data/match-lambdas";

import type {
  JudgmentAnswers,
  JudgmentFactor,
  JudgmentQuestionId,
  TeamSide,
} from "./types";

// Conversão julgamento → ajuste de λ (ADR 0041 §3): limitada, monotônica, no
// código. Pesos são código versionado, nunca aprendidos em runtime; mudou peso,
// limiar ou clamp → bump JUDGMENT_WEIGHTS_VERSION.
export const JUDGMENT_WEIGHTS_VERSION = "judgment_weights_v1";

export const JUDGMENT_WEIGHTS: Record<JudgmentFactor, number> = {
  attack_weakened: 0.06,
  defense_weakened: 0.06,
  rotation_risk: 0.05,
  high_stakes: 0.03,
};

// Sinal e alvo de cada fator (coluna "Efeito" da tabela da Decisão 2).
const FACTOR_EFFECT: Record<
  JudgmentFactor,
  { sign: 1 | -1; target: "own" | "opponent" }
> = {
  attack_weakened: { sign: -1, target: "own" },
  defense_weakened: { sign: 1, target: "opponent" },
  rotation_risk: { sign: -1, target: "own" },
  high_stakes: { sign: 1, target: "own" },
};

export const TEAM_MULTIPLIER_MIN = 0.85;
export const TEAM_MULTIPLIER_MAX = 1.15;

const NEUTRAL_NOUL = 0.5;

export type LambdaMultipliers = {
  // Multiplicador de cada fator que incide neste λ, por id de pergunta.
  factors: Partial<Record<JudgmentQuestionId, number>>;
  product: number;
  // Produto após o clamp — o que de fato multiplica o λ.
  applied: number;
};

export type JudgmentMultipliers = {
  home: LambdaMultipliers;
  away: LambdaMultipliers;
};

export type AppliedJudgments = {
  lambdaHome: number;
  lambdaAway: number;
  multipliers: JudgmentMultipliers | null;
  applied: boolean;
};

// Unilateral: só o "sim" (noul > 0.5) move λ. Um "não" (sem desfalque, sem
// rotação) deixa λ intacto — com a forma simétrica original, o jogo típico sem
// desfalques ganhava ~+1.5% de λ por viés. Nouls não trazem `confidence` na
// API; a margem acima de 0.5 já é a força do sinal, então não há gating.
export function factorMultiplier(
  factor: JudgmentFactor,
  value: number
): number {
  if (!Number.isFinite(value)) return 1;
  const noul = Math.min(1, Math.max(0, value));
  const { sign } = FACTOR_EFFECT[factor];
  return (
    1 + sign * JUDGMENT_WEIGHTS[factor] * Math.max(0, noul - NEUTRAL_NOUL) * 2
  );
}

const OTHER_SIDE: Record<TeamSide, TeamSide> = { home: "away", away: "home" };

function lambdaMultipliers(
  side: TeamSide,
  answers: JudgmentAnswers
): LambdaMultipliers {
  const factors: Partial<Record<JudgmentQuestionId, number>> = {};
  let product = 1;
  for (const factor of Object.keys(FACTOR_EFFECT) as JudgmentFactor[]) {
    const source =
      FACTOR_EFFECT[factor].target === "own" ? side : OTHER_SIDE[side];
    const id: JudgmentQuestionId = `${factor}_${source}`;
    const m = factorMultiplier(factor, answers[id].value);
    factors[id] = m;
    product *= m;
  }
  const applied = Math.min(
    TEAM_MULTIPLIER_MAX,
    Math.max(TEAM_MULTIPLIER_MIN, product)
  );
  return { factors, product, applied };
}

// null (JEV falhou/sem chave) → identidade com applied=false: fail-open pro
// estatístico puro, nunca bloqueia a análise.
export function applyJudgments(
  lambdas: Pick<MatchLambdas, "lambdaHome" | "lambdaAway">,
  judgments: JudgmentAnswers | null
): AppliedJudgments {
  if (!judgments) {
    return {
      lambdaHome: lambdas.lambdaHome,
      lambdaAway: lambdas.lambdaAway,
      multipliers: null,
      applied: false,
    };
  }
  const home = lambdaMultipliers("home", judgments);
  const away = lambdaMultipliers("away", judgments);
  return {
    lambdaHome: lambdas.lambdaHome * home.applied,
    lambdaAway: lambdas.lambdaAway * away.applied,
    multipliers: { home, away },
    applied: true,
  };
}
