// Modelo de placar determinístico — double-Poisson com correção Dixon-Coles.
// ADR 0036, Decisão 9 (issue #452). Módulo PURO, síncrono, determinístico:
// ZERO imports de @/lib/db, @/lib/ai, @/lib/providers (nem types). Os tipos de
// input são ESTRUTURAIS próprios; cada consumidor adapta na SUA fronteira (a
// aposta livre adapta de NormalizedStandingTeam.homeSplit/awaySplit; o item 3 do
// Report 03 consumirá depois sob ADR próprio). Não é a primeira probabilidade de
// LLM do repo — é a primeira probabilidade de MODELO, testável e calibrável.
//
// A Fase 1 (#471, tracer) exercita SÓ `pScoreline` (placar exato). Os demais
// readers (pMarginAtLeast/pCleanSheet/pOverUnder/p1X2/κ de 1º tempo/pHomeScoresFirst)
// são Fase 2 (#472) — este arquivo os recebe depois SEM mudar a matriz.

// Taxa de gols por mando de um time (fatia casa OU fora do standings). Estrutural:
// NÃO importa NormalizedStandingSplit — o adapter do consumidor mapeia.
export type SplitGoalRates = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type EstimateLambdasInput = {
  // Taxas de gol do MANDANTE e do VISITANTE, já resolvidas pelo ADAPTER na sua
  // fronteira (Decisão 3): jogo normal → fatia CASA do mandante × fatia FORA do
  // visitante (captura a vantagem de mando sem termo HFA); mando neutro (Copa) → o
  // pool casa+fora POR TIME (via poolSplitRates). null quando a tabela não traz o
  // split → degrau (ii). O módulo é agnóstico ao mando — só recebe as taxas prontas.
  home: SplitGoalRates | null;
  away: SplitGoalRates | null;
  // Gols médios por time-jogo da liga (Σ goalsFor / Σ played das colunas OVERALL),
  // computado pelo adapter na fronteira. PRECONDIÇÃO: finito e > 0 — o caller guarda
  // o caso degenerado (Σ played = 0) ANTES de chamar (Decisão 3, guarda B1).
  leagueAvgGoalsPerTeam: number;
};

export type LambdaMeta = {
  // "splits" = degrau (i) Maher + shrinkage; "prior" = degrau (ii) λ = média da liga
  // (splits ausentes ou amostra < MIN_GAMES_FOR_SPLITS). Rótulo "dados limitados" na UI
  // ⟺ "prior".
  source: "splits" | "prior";
};

export type ScorelineMatrix = {
  // cells[h][a] = P(mandante h × visitante a), renormalizada (Σ = 1).
  cells: number[][];
  maxGoals: number;
};

// ── Constantes PINADAS (ADR Decisão 9; goldens dependem delas) ───────────────
export const SHRINKAGE_PSEUDO_GAMES = 5; // k: jogos-equivalentes do prior
export const MAX_GOALS = 10; // truncamento da matriz (renormalizada)
export const DIXON_COLES_RHO = -0.1; // ρ: dependência dos placares baixos
export const LAMBDA_MIN = 0.2;
export const LAMBDA_MAX = 4.5;
export const MIN_GAMES_FOR_SPLITS = 5; // amostra mínima por time pro degrau (i)

function clampLambda(lambda: number): number {
  // NaN → o menor λ são (conservador: nunca infla a probabilidade de uma perna).
  // ±Infinity o Math.min/max já resolvem (→ LAMBDA_MAX / LAMBDA_MIN).
  if (Number.isNaN(lambda)) return LAMBDA_MIN;
  return Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, lambda));
}

// Encolhe uma taxa observada pro prior da liga com pseudo-contagem fixa k:
// λ_post = (n·λ_obs + k·λ_liga) / (n + k). Forma pinada no ADR.
function shrink(rate: number, played: number, leaguePrior: number): number {
  return (
    (played * rate + SHRINKAGE_PSEUDO_GAMES * leaguePrior) /
    (played + SHRINKAGE_PSEUDO_GAMES)
  );
}

function usableSplit(split: SplitGoalRates | null): split is SplitGoalRates {
  return split !== null && split.played >= MIN_GAMES_FOR_SPLITS;
}

// Pool de DUAS fatias do MESMO time (casa+fora) — usado pelo adapter no mando
// neutro (Copa/mata-mata): a soma das contagens vira a taxa geral do time, sem
// distinção de mando. EXPORTADO pra o adapter poolear POR TIME (cada consumidor
// adapta na sua fronteira — o módulo não conhece "mando"). null se nenhuma existir.
export function poolSplitRates(
  a: SplitGoalRates | null,
  b: SplitGoalRates | null,
): SplitGoalRates | null {
  const parts = [a, b].filter((s): s is SplitGoalRates => s !== null);
  if (parts.length === 0) return null;
  return {
    played: parts.reduce((s, p) => s + p.played, 0),
    goalsFor: parts.reduce((s, p) => s + p.goalsFor, 0),
    goalsAgainst: parts.reduce((s, p) => s + p.goalsAgainst, 0),
  };
}

/**
 * Estima (λ_mandante, λ_visitante) pela forma multiplicativa de Maher com
 * shrinkage. Escada de degradação (Decisão 3):
 *  (i)  splits usáveis nos DOIS times (played ≥ MIN_GAMES_FOR_SPLITS) → Maher +
 *       shrinkage → meta.source = "splits".
 *  (ii) qualquer time sem split usável → λ = prior de liga puro nos dois →
 *       meta.source = "prior" (rótulo "dados limitados").
 * (iii) standings indisponível → NÃO é responsabilidade do módulo: o adapter não
 *       chama esta função e devolve "não avalio" (prefer-skip).
 *
 * O mando (casa/fora/neutro) já foi resolvido pelo adapter nas taxas home/away —
 * este módulo é agnóstico. Defensivo: qualquer λ não-finito recai no degrau (ii) —
 * o módulo puro NUNCA devolve λ NaN (guarda B1 do review).
 */
export function estimateLambdas(input: EstimateLambdasInput): {
  lambdaHome: number;
  lambdaAway: number;
  meta: LambdaMeta;
} {
  const prior = input.leagueAvgGoalsPerTeam;
  const priorResult = {
    lambdaHome: clampLambda(prior),
    lambdaAway: clampLambda(prior),
    meta: { source: "prior" as const },
  };

  // Precondição violada (caller deveria ter guardado) → prior é o mais seguro que dá.
  if (!Number.isFinite(prior) || prior <= 0) return priorResult;

  const homeSplit = input.home;
  const awaySplit = input.away;

  if (!usableSplit(homeSplit) || !usableSplit(awaySplit)) return priorResult;

  const atkHome = homeSplit.goalsFor / homeSplit.played;
  const defHome = homeSplit.goalsAgainst / homeSplit.played;
  const atkAway = awaySplit.goalsFor / awaySplit.played;
  const defAway = awaySplit.goalsAgainst / awaySplit.played;

  // λ_home = (ataque casa do mandante) × (defesa fora do visitante) / média-liga,
  // cada taxa encolhida pro prior. Equivale a leagueAvg · atkStrength · defStrength.
  const lambdaHome =
    (shrink(atkHome, homeSplit.played, prior) *
      shrink(defAway, awaySplit.played, prior)) /
    prior;
  const lambdaAway =
    (shrink(atkAway, awaySplit.played, prior) *
      shrink(defHome, homeSplit.played, prior)) /
    prior;

  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) {
    return priorResult;
  }

  return {
    lambdaHome: clampLambda(lambdaHome),
    lambdaAway: clampLambda(lambdaAway),
    meta: { source: "splits" },
  };
}

// P(X = k) pra X ~ Poisson(λ), k inteiro ≥ 0. Forma iterativa estável até k≈10.
function poissonPmf(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}

/**
 * Matriz de placar double-Poisson truncada em MAX_GOALS, com correção Dixon-Coles
 * τ nas 4 células de placar baixo (0-0, 1-0, 0-1, 1-1) e renormalização final
 * (Σ = 1). A correção captura a dependência empírica que o produto independente
 * de dois Poisson erra. Guarda de validade: τ clampado a ≥ 0 (λ absurdo de um
 * adapter bugado não pode virar célula negativa silenciosa).
 *
 * opts.rho permite τ=0 (ρ=0 → produto puro) pros testes-oráculo; opts.maxGoals
 * encurta a matriz. Defaults = as constantes pinadas.
 */
export function scorelineMatrix(
  lambdaHome: number,
  lambdaAway: number,
  opts?: { rho?: number; maxGoals?: number },
): ScorelineMatrix {
  const rho = opts?.rho ?? DIXON_COLES_RHO;
  const maxGoals = opts?.maxGoals ?? MAX_GOALS;

  const homePmf = Array.from({ length: maxGoals + 1 }, (_, h) =>
    poissonPmf(h, lambdaHome),
  );
  const awayPmf = Array.from({ length: maxGoals + 1 }, (_, a) =>
    poissonPmf(a, lambdaAway),
  );

  const cells: number[][] = homePmf.map((ph) => awayPmf.map((pa) => ph * pa));

  // τ de Dixon-Coles (clássico), clampado a ≥ 0.
  const tau00 = Math.max(0, 1 - lambdaHome * lambdaAway * rho);
  const tau01 = Math.max(0, 1 + lambdaHome * rho);
  const tau10 = Math.max(0, 1 + lambdaAway * rho);
  const tau11 = Math.max(0, 1 - rho);
  cells[0][0] *= tau00;
  cells[0][1] *= tau01;
  cells[1][0] *= tau10;
  cells[1][1] *= tau11;

  let sum = 0;
  for (const row of cells) for (const c of row) sum += c;
  // sum > 0 sempre (célula (0,0) = e^-λh·e^-λa·τ00 > 0 pra λ finitos).
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) cells[h][a] /= sum;
  }

  return { cells, maxGoals };
}

// P(placar exato = home × away). Fora do range truncado → 0 (célula não modelada).
export function pScoreline(
  matrix: ScorelineMatrix,
  home: number,
  away: number,
): number {
  if (
    home < 0 ||
    away < 0 ||
    home > matrix.maxGoals ||
    away > matrix.maxGoals ||
    !Number.isInteger(home) ||
    !Number.isInteger(away)
  ) {
    return 0;
  }
  return matrix.cells[home][away];
}
