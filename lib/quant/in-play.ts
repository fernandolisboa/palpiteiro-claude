// Modelo em jogo (#580/#591, PLAN-580 §6): a matriz de placar FINAL condicionada ao
// placar atual e ao tempo que falta, com desconto por expulsão. Módulo PURO como o resto
// de `lib/quant` (sem banco, sem provider, sem servidor): roda também no cliente
// (leitura do "Seu palpite" pelos botões). Entrada estrutural própria; quem chama
// adapta o estado do provider na sua fronteira.
//
// Todo leitor da MATRIZ (1X2, dupla chance, BTTS, over/under, placar exato, margem,
// clean sheet, combinada) funciona sem mudança sobre o resultado. Quem recalcula do λ
// (1º tempo pela κ, "quem marca primeiro") sai errado ao vivo: esses tipos ficam fora
// (§6.5) e `priceLeg` recusa (isInPlayScoreline).

import type { ModelScoreline } from "./match-model";
import {
  DIXON_COLES_RHO,
  dixonColesTau,
  KAPPA_FIRST_HALF,
  MAX_GOALS,
  poissonPmf,
  type ScorelineMatrix,
} from "./scoreline-model";

// Versão do modelo em jogo: vai no model_version e no live_state. Mudou fórmula ou
// constante → bump.
export const LIVE_MODEL_VERSION = "live_model_v1";

// ── Constantes do live_model_v1 (PROVISÓRIAS: a calibrar com os registros ao vivo) ──
// Fatia de gols de cada tempo: κ₁ do 1º tempo (a mesma do mercado de 1º tempo), κ₂ = 1 − κ₁.
export const KAPPA_SECOND_HALF = 1 - KAPPA_FIRST_HALF;
// Acréscimo esperado (min) e duração esperada de cada tempo.
export const EXPECTED_STOPPAGE_FIRST_HALF = 3;
export const EXPECTED_STOPPAGE_SECOND_HALF = 6;
export const FIRST_HALF_LENGTH = 45 + EXPECTED_STOPPAGE_FIRST_HALF;
export const SECOND_HALF_LENGTH = 45 + EXPECTED_STOPPAGE_SECOND_HALF;
// Piso do que falta num tempo ainda rolando: acréscimo maior que o esperado não zera r.
export const MIN_REMAINING_MINUTES = 0.5;
// Multiplicadores do λ RESTANTE por expulsão líquida (literatura: quem fica com menos
// marca ~30% menos, o adversário ~20-30% mais).
export const RED_OWN = 0.7;
export const RED_OPP = 1.25;
// |vermelhos mandante − vermelhos visitante| considerado (3+ de um lado é raríssimo).
export const MAX_NET_RED = 2;

const SCHEDULED_CODES = new Set(["TBD", "NS"]);
const EXTRA_TIME_CODES = new Set(["ET", "BT", "P"]);
const INTERRUPTED_CODES = new Set(["INT", "SUSP"]);
const TERMINAL_CODES = new Set([
  "FT",
  "AET",
  "PEN",
  "AWD",
  "WO",
  "PST",
  "CANC",
  "ABD",
]);

// Relógio do jogo como o provider manda (código curto + minuto + acréscimo).
export type InPlayClock = {
  statusShort: string;
  elapsed: number | null;
  extra: number | null;
};

// Estado do jogo que o modelo consome. `score` = placar atual (em 1H/HT/2H, o de 90' em
// andamento); `red` null = sem dados de expulsão (sem ajuste).
export type InPlayInput = InPlayClock & {
  score: { home: number; away: number };
  red: { home: number; away: number } | null;
};

export type InPlayPeriod = "not_started" | "first_half" | "half_time" | "second_half";

export type RemainingFraction =
  | { ok: true; r: number; period: InPlayPeriod; minuteInPeriod: number | null }
  | {
      ok: false;
      // extra_time: ET/BT/P, os mercados de 90' já estão decididos; terminal: jogo
      // encerrado/adiado/cancelado; minute_unknown: 1H/2H sem minuto ou LIVE;
      // interrupted: INT/SUSP; unknown_status: código que o modelo não conhece.
      reason:
        | "extra_time"
        | "terminal"
        | "minute_unknown"
        | "interrupted"
        | "unknown_status";
    };

/**
 * Minuto `m` jogado dentro do tempo `k` (1 ou 2), PLAN-580 §6.2:
 * `m = max(0, (extra != null ? min(elapsed, 45·k) + extra : elapsed) − 45·(k−1))`.
 * Cobre 45+2 (`elapsed 45, extra 2` → 47), provider que manda `elapsed 47` sem `extra`
 * e o reinício do 2º tempo com `elapsed 45` (→ 0).
 */
export function minuteInPeriod(
  elapsed: number,
  extra: number | null,
  period: 1 | 2,
): number {
  const clock = extra !== null ? Math.min(elapsed, 45 * period) + extra : elapsed;
  return Math.max(0, clock - 45 * (period - 1));
}

/**
 * Fração `r` dos gols do jogo que ainda falta (PLAN-580 §6.2). Cada tempo é uniforme
 * na sua duração esperada com acréscimos (limite conhecido do v1: a intensidade sobe no
 * fim do 2º tempo e depende do placar). Não crescente no tempo; r = 1 no minuto 0 do
 * 1º tempo e no atraso (NS/TBD depois do apito); HT = κ₂.
 */
export function remainingFraction(clock: InPlayClock): RemainingFraction {
  const { statusShort: s, elapsed, extra } = clock;
  if (SCHEDULED_CODES.has(s)) {
    return { ok: true, r: 1, period: "not_started", minuteInPeriod: 0 };
  }
  if (s === "HT") {
    return { ok: true, r: KAPPA_SECOND_HALF, period: "half_time", minuteInPeriod: null };
  }
  if (s === "1H" || s === "2H") {
    if (elapsed === null || !Number.isFinite(elapsed)) {
      return { ok: false, reason: "minute_unknown" };
    }
    const extraMin = extra !== null && Number.isFinite(extra) ? extra : null;
    if (s === "1H") {
      const m = minuteInPeriod(elapsed, extraMin, 1);
      const left = Math.max(FIRST_HALF_LENGTH - m, MIN_REMAINING_MINUTES);
      return {
        ok: true,
        r: (KAPPA_FIRST_HALF * left) / FIRST_HALF_LENGTH + KAPPA_SECOND_HALF,
        period: "first_half",
        minuteInPeriod: m,
      };
    }
    const m = minuteInPeriod(elapsed, extraMin, 2);
    const left = Math.max(SECOND_HALF_LENGTH - m, MIN_REMAINING_MINUTES);
    return {
      ok: true,
      r: (KAPPA_SECOND_HALF * left) / SECOND_HALF_LENGTH,
      period: "second_half",
      minuteInPeriod: m,
    };
  }
  if (s === "LIVE") return { ok: false, reason: "minute_unknown" };
  if (INTERRUPTED_CODES.has(s)) return { ok: false, reason: "interrupted" };
  if (EXTRA_TIME_CODES.has(s)) return { ok: false, reason: "extra_time" };
  if (TERMINAL_CODES.has(s)) return { ok: false, reason: "terminal" };
  return { ok: false, reason: "unknown_status" };
}

/**
 * Rótulo curto do minuto pro carimbo do modelo ("63'", "45+2'", "intervalo", "0'").
 * Só pros relógios em que há leitura; o rótulo da tela mora em lib/live/phase.ts.
 */
export function inPlayMinuteLabel(clock: InPlayClock): string {
  if (SCHEDULED_CODES.has(clock.statusShort)) return "0'";
  if (clock.statusShort === "HT") return "intervalo";
  if (clock.elapsed === null) return "";
  return clock.extra !== null && clock.extra > 0
    ? `${clock.elapsed}+${clock.extra}'`
    : `${clock.elapsed}'`;
}

/**
 * Multiplicadores do λ restante pela expulsão líquida `d = clamp(redHome − redAway, ±2)`
 * (PLAN-580 §6.3). d > 0 (mandante com menos): mandante × RED_OWN^d, visitante ×
 * RED_OPP^d; d < 0 espelhado. 1×1 se anula (simplificação aceita). Sem dados → 1 e 1.
 */
export function redCardMultipliers(
  red: { home: number; away: number } | null,
): { home: number; away: number; netRed: number | null } {
  if (red === null) return { home: 1, away: 1, netRed: null };
  const raw = red.home - red.away;
  const d = Math.max(-MAX_NET_RED, Math.min(MAX_NET_RED, raw));
  if (d > 0) return { home: RED_OWN ** d, away: RED_OPP ** d, netRed: d };
  if (d < 0) return { home: RED_OPP ** -d, away: RED_OWN ** -d, netRed: d };
  return { home: 1, away: 1, netRed: 0 };
}

export type ConditionedMatrixArgs = {
  // λ e ρ do PRÉ-JOGO (cheios, sem desconto de expulsão): parametrizam o τ do placar final.
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  // Gols que faltam (λ·r·multiplicador) e o placar atual.
  muHome: number;
  muAway: number;
  score: { home: number; away: number };
};

/**
 * Matriz FINAL condicionada ao placar atual (PLAN-580 §6.4, R2):
 * `F[h][a] ∝ Pois(h − h0; μH) · Pois(a − a0; μA) · τ(h, a; λH, λA, ρ)` para h ≥ h0 e
 * a ≥ a0, 0 no resto, renormalizada. O τ é o do placar FINAL com os parâmetros do
 * pré-jogo: só pesa enquanto o placar atual alcança alguma das células 0-0/1-0/0-1/1-1.
 * Grade 0..max(h0, a0) + MAX_GOALS; gols restantes truncados em MAX_GOALS, como no
 * pré-jogo. `mass` = o normalizador (Σ antes de renormalizar), exposto pra a conferência
 * de coerência com o pré-jogo.
 *
 * Com μ = λ (r = 1), 0-0 e sem expulsão, refaz a conta de scorelineMatrix célula a célula.
 */
export function conditionedScorelineMatrix(args: ConditionedMatrixArgs): {
  matrix: ScorelineMatrix;
  mass: number;
} {
  const { lambdaHome, lambdaAway, rho, muHome, muAway } = args;
  const h0 = args.score.home;
  const a0 = args.score.away;
  const maxGoals = Math.max(h0, a0) + MAX_GOALS;

  const homePmf = Array.from({ length: maxGoals + 1 }, (_, h) =>
    h < h0 || h - h0 > MAX_GOALS ? 0 : poissonPmf(h - h0, muHome),
  );
  const awayPmf = Array.from({ length: maxGoals + 1 }, (_, a) =>
    a < a0 || a - a0 > MAX_GOALS ? 0 : poissonPmf(a - a0, muAway),
  );

  const cells: number[][] = homePmf.map((ph, h) =>
    awayPmf.map(
      (pa, a) => ph * pa * dixonColesTau(h, a, lambdaHome, lambdaAway, rho),
    ),
  );

  let mass = 0;
  for (const row of cells) for (const c of row) mass += c;
  // mass > 0 pra μ finitos: a célula do placar atual vale e^-μH·e^-μA·τ, e τ só zera
  // com λ/ρ absurdos (aí a do placar atual + 1 gol fica positiva).
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) cells[h][a] /= mass;
  }
  return { matrix: { cells, maxGoals }, mass };
}

export type InPlayMeta = {
  liveModelVersion: typeof LIVE_MODEL_VERSION;
  r: number;
  minuteLabel: string;
  score: { home: number; away: number };
  red: { home: number; away: number } | null;
  muHome: number;
  muAway: number;
  multipliers: { home: number; away: number };
  preMatch: {
    source: ModelScoreline["source"];
    lambdaHome: number;
    lambdaAway: number;
    rho: number;
    baseCheckedAt: Date | null;
  };
};

// `inPlay` é OBRIGATÓRIO: é por ele que os leitores do λ (priceLeg) reconhecem a matriz
// em jogo. `lambdaHome/lambdaAway` = gols esperados no FIM (h0 + μH), só pra exibição.
export type InPlayScoreline = ModelScoreline & { inPlay: InPlayMeta };

export function isInPlayScoreline(
  model: ModelScoreline,
): model is InPlayScoreline {
  return (model as Partial<InPlayScoreline>).inPlay != null;
}

function validScore(score: { home: number; away: number }): boolean {
  return [score.home, score.away].every((g) => Number.isInteger(g) && g >= 0);
}

/**
 * Modelo em jogo a partir do pré-jogo (o modelo que a página mostrava no apito,
 * resolveSlipModel com asOf) e do estado atual. null = sem leitura: prorrogação/pênaltis
 * (mercados de 90' decididos), jogo encerrado, minuto desconhecido, interrompido, código
 * desconhecido, placar inválido ou λ não finito. Nunca lança.
 */
export function inPlayScoreline(
  pre: ModelScoreline,
  state: InPlayInput,
): InPlayScoreline | null {
  const fraction = remainingFraction(state);
  if (!fraction.ok) return null;
  if (!validScore(state.score)) return null;
  const { lambdaHome, lambdaAway } = pre;
  if (
    !Number.isFinite(lambdaHome) ||
    !Number.isFinite(lambdaAway) ||
    lambdaHome < 0 ||
    lambdaAway < 0
  ) {
    return null;
  }
  const rho = pre.rho ?? DIXON_COLES_RHO;
  const { r } = fraction;
  const mult = redCardMultipliers(state.red);
  const muHome = lambdaHome * r * mult.home;
  const muAway = lambdaAway * r * mult.away;
  const { matrix } = conditionedScorelineMatrix({
    lambdaHome,
    lambdaAway,
    rho,
    muHome,
    muAway,
    score: state.score,
  });
  return {
    source: pre.source,
    degraded: pre.degraded,
    lambdaHome: state.score.home + muHome,
    lambdaAway: state.score.away + muAway,
    rho,
    matrix,
    ...(pre.fallbackReason ? { fallbackReason: pre.fallbackReason } : {}),
    ...(pre.baseCheckedAt ? { baseCheckedAt: pre.baseCheckedAt } : {}),
    inPlay: {
      liveModelVersion: LIVE_MODEL_VERSION,
      r,
      minuteLabel: inPlayMinuteLabel(state),
      score: { ...state.score },
      red: state.red ? { ...state.red } : null,
      muHome,
      muAway,
      multipliers: { home: mult.home, away: mult.away },
      preMatch: {
        source: pre.source,
        lambdaHome,
        lambdaAway,
        rho,
        baseCheckedAt: pre.baseCheckedAt ?? null,
      },
    },
  };
}

// ── Seleção já decidida pelo placar atual (PLAN-580 §6.5, R4) ──────────────────
// Predicado sobre o placar, nunca P ∈ {0, 1} (a soma em ponto flutuante dá 0,9999…).
// Só os tipos do placar FINAL: 1X2, dupla chance e margem nunca se decidem antes do fim;
// 1º tempo e "quem marca primeiro" ficam fora do ao vivo e voltam null (em aberto).

export type DecidedOutcome = "won" | "lost";

export function decidedOutcome(
  kind: string,
  params: Record<string, unknown>,
  score: { home: number; away: number },
): DecidedOutcome | null {
  const { home: h0, away: a0 } = score;
  switch (kind) {
    case "over_under": {
      const line = Number(params.line);
      if (!Number.isFinite(line) || !(h0 + a0 > line)) return null;
      return params.selection === "over" ? "won" : "lost";
    }
    case "btts": {
      if (!(h0 >= 1 && a0 >= 1)) return null;
      return params.selection === "yes" ? "won" : "lost";
    }
    case "exact_score": {
      const home = Number(params.home);
      const away = Number(params.away);
      return h0 > home || a0 > away ? "lost" : null;
    }
    case "clean_sheet": {
      const conceded = params.side === "home" ? a0 : h0;
      return conceded >= 1 ? "lost" : null;
    }
    default:
      return null;
  }
}

export function isDecided(
  kind: string,
  params: Record<string, unknown>,
  score: { home: number; away: number },
): boolean {
  return decidedOutcome(kind, params, score) !== null;
}
