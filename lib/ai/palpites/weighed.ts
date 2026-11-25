// "O que pesou" no palpite (#683, PLAN-683 §2–§3). PURO e determinístico.
//
// O palpite decidido em código (pick.ts) é a base (λ do mercado ou do modelo) vezes os
// multiplicadores de cada fator. Aqui a conta é refeita fator a fator, em ordem fixa, e
// cada fator ganha o efeito dele nas chances do 1X2: em pp crus e em pontos inteiros que
// fecham com a barra (base e palpite em inteiros que somam 100). Gravado em
// `headline.pick.weighed`; a view lê só isso, por Zod (lib/view/palpite-weighed.ts).
//
// Inteiros: cada fator soma 0 e cada coluna fecha com palpite − base; nenhum ponto
// contradiz o sinal do efeito cru em NENHUM dos três resultados (o empate inclusive):
// um fator que tirou chance do empate nunca aparece dando chance a ele
// (apportionTable, lib/quant/apportion.ts).
//
// Fail-closed: quando a decomposição não fecha com o palpite exibido (multiplicadores
// incoerentes ou fator desconhecido no produto, clamp que não encolhe, linha antiga com a
// regra simétrica, rateio que trocaria um sinal, jsonb torto), o campo sai null e o
// bloco não aparece.

import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { factorMultiplier } from "@/lib/ai/judgments/apply";
import {
  JUDGMENT_FACTORS,
  type JudgmentFactor,
  type JudgmentQuestionId,
  type TeamSide,
} from "@/lib/ai/judgments/types";
import { modelAnswersOf } from "@/lib/match-news/model-answers";
import { apportionTable, largestRemainder } from "@/lib/quant/apportion";
import {
  mostLikelyOutcome,
  p1X2,
  scorelineMatrix,
  type MatchOutcome,
} from "@/lib/quant/scoreline-model";
import { PredictionUserContextSchema } from "@/lib/user-palpite/types";

export const PALPITE_WEIGHED_VERSION = "palpite_weighed_v1" as const;

export type OutcomeTriple = { home: number; draw: number; away: number };

type Pair = { home: number; away: number };

// Quem deu o MÁXIMO na pergunta. No jsonb é string: o leitor aceita origem desconhecida.
export type WeighedOrigin = "jev" | "news" | "user";

export type WeighedFactor = {
  // JudgmentQuestionId hoje ("attack_weakened_home"); chave da frase na view.
  key: string;
  // Qual λ ele multiplica (o lado em judgments.multipliers.{side}.factors).
  lambdaSide: TeamSide;
  origin: string;
  // Noul de quem deu o máximo, 2 casas (a força do sinal).
  value: number;
  // Efetivo, depois do corte proporcional do clamp, 6 casas.
  multiplier: number;
  // Efeito cru em pp, 2 casas. Auditoria: a view não lê.
  pp: OutcomeTriple;
  // Inteiros, soma 0; Σ fatores = finalPts − basePts, resultado a resultado.
  pts: OutcomeTriple;
};

export type PalpiteWeighed = {
  version: typeof PALPITE_WEIGHED_VERSION;
  // P(1X2) da matriz base (sem fator), pp 2 casas.
  baseProbs: OutcomeTriple;
  // mostLikelyOutcome da base: a mesma regra do pick.
  baseOutcome: MatchOutcome;
  // Inteiros que somam 100 (maior resto).
  basePts: OutcomeTriple;
  finalPts: OutcomeTriple;
  // Na ordem em que foram aplicados; [] = nenhum fator mexeu.
  factors: WeighedFactor[];
  clamped: { home: boolean; away: boolean };
};

// ─── Entrada: fatores e origens de UMA análise (a de onde saiu o multiplicador) ─────

export type WeighedInputFactor = {
  key: JudgmentQuestionId;
  lambdaSide: TeamSide;
  multiplier: number;
  origin: WeighedOrigin;
  value: number;
};

export type WeighedInputs = {
  // Em ordem canônica (JUDGMENT_FACTORS × mandante, visitante), nunca a do jsonb.
  factors: WeighedInputFactor[];
  // O que de fato multiplicou cada λ (depois do clamp) e o produto antes dele.
  applied: Pair;
  product: Pair;
};

const SIDES: readonly TeamSide[] = ["home", "away"];
const NEUTRAL = 0.5;

// Ordem canônica das perguntas, a mesma de judgmentFactorPhrases.
const CANONICAL: readonly JudgmentQuestionId[] = JUDGMENT_FACTORS.flatMap((f) =>
  SIDES.map((s) => `${f}_${s}` as JudgmentQuestionId)
);

const round = (x: number, d: number) => Number(x.toFixed(d));

/**
 * Os fatores que mexeram no λ de uma análise code_jev, com a origem de cada um (quem deu
 * o máximo na pergunta, a regra do claimEffect e do applyNewsClaims; empate fica com a
 * fonte anterior: JEV, depois notícia, depois usuário).
 *
 * - null: não é code_jev, ou o contexto extra está ilegível (na dúvida, nenhum fator,
 *   como no synthesisFactorPhrases do #565);
 * - `factors: []`: code_jev sem multiplicadores (JEV falhou, sem contexto): nada mexeu.
 */
export function weighedFactorInputs(
  judgments: PredictionJudgments | null | undefined
): WeighedInputs | null {
  // O jsonb persistido pode vir torto (linha antiga, gravação parcial): ler os fatores
  // nunca derruba a análise nem o "Gerar só o palpite"; sai sem leitura.
  try {
    return readFactorInputs(judgments);
  } catch {
    console.warn({ scope: "palpite_weighed", reason: "error" });
    return null;
  }
}

function readFactorInputs(
  judgments: PredictionJudgments | null | undefined
): WeighedInputs | null {
  if (!judgments || judgments.engine !== "code_jev") return null;
  let userEvidence: Partial<Record<JudgmentQuestionId, number>> = {};
  if (judgments.userContext !== undefined) {
    const parsed = PredictionUserContextSchema.safeParse(judgments.userContext);
    if (!parsed.success) return null;
    userEvidence = parsed.data.evidence;
  }
  const m = judgments.multipliers;
  if (!m) {
    return {
      factors: [],
      applied: { home: 1, away: 1 },
      product: { home: 1, away: 1 },
    };
  }
  // O que o número já tinha antes do usuário: JEV ∨ notícia (helper único do #672).
  const model = modelAnswersOf(judgments);
  const newsEvidence = judgments.news?.evidence ?? {};
  const factors: WeighedInputFactor[] = [];
  for (const key of CANONICAL) {
    for (const side of SIDES) {
      const multiplier = m[side].factors[key];
      if (multiplier === undefined || Math.abs(multiplier - 1) <= 1e-12)
        continue;
      const jev = judgments.answers?.[key]?.value ?? 0;
      const news = newsEvidence[key] ?? 0;
      const user = userEvidence[key] ?? 0;
      const origin: WeighedOrigin =
        user > Math.max(NEUTRAL, model?.[key]?.value ?? 0)
          ? "user"
          : news > Math.max(NEUTRAL, jev)
            ? "news"
            : "jev";
      const value = origin === "user" ? user : origin === "news" ? news : jev;
      factors.push({ key, lambdaSide: side, multiplier, origin, value });
    }
  }
  return {
    factors,
    applied: { home: m.home.applied, away: m.away.applied },
    product: { home: m.home.product, away: m.away.product },
  };
}

// ─── A conta, fator a fator ──────────────────────────────────────────────────

const ORIGIN_ORDER = ["jev", "news", "user"];

function originRank(origin: string): number {
  const i = ORIGIN_ORDER.indexOf(origin);
  return i === -1 ? ORIGIN_ORDER.length : i;
}

function canonicalRank(key: string): number {
  const i = CANONICAL.indexOf(key as JudgmentQuestionId);
  return i === -1 ? CANONICAL.length : i;
}

// jev → news → user (desconhecida por último, alfabética); dentro da origem, canônica.
function orderFactors<T extends { origin: string; key: string }>(
  fs: readonly T[]
): T[] {
  return [...fs].sort(
    (a, b) =>
      originRank(a.origin) - originRank(b.origin) ||
      a.origin.localeCompare(b.origin) ||
      canonicalRank(a.key) - canonicalRank(b.key) ||
      a.key.localeCompare(b.key)
  );
}

function factorOf(key: string): JudgmentFactor | null {
  return (
    JUDGMENT_FACTORS.find((f) => key === `${f}_home` || key === `${f}_away`) ??
    null
  );
}

export type WeighReason =
  | "no_factors"
  | "factor_direction"
  | "clamp"
  | "multiplier_mismatch"
  | "sequence_mismatch"
  | "rounding_conflict";

export type WeighResult =
  | { ok: true; weighed: PalpiteWeighed }
  | { ok: false; reason: WeighReason };

export type WeighArgs = {
  // λ antes dos fatores (PalpiteBase.base) e ρ da matriz.
  base: Pair;
  rho: number;
  // Os fatores da análise de onde saiu o multiplicador do pick; null = sem leitura.
  inputs: WeighedInputs | null;
  // adjusted/base do pick; null = sem ajuste.
  multipliers: Pair | null;
  // P(1X2) crua do pick (fração), pra conferir que a conta fecha com o exibido.
  finalRaw: OutcomeTriple;
};

const isIdentity = (m: Pair | null) =>
  !m || (Math.abs(m.home - 1) <= 1e-9 && Math.abs(m.away - 1) <= 1e-9);

const probsOf = (l: Pair, rho: number): OutcomeTriple =>
  p1X2(scorelineMatrix(l.home, l.away, { rho }));

const triple = (f: (k: MatchOutcome) => number): OutcomeTriple => ({
  home: f("home"),
  draw: f("draw"),
  away: f("away"),
});

const OUTCOMES: readonly MatchOutcome[] = ["home", "draw", "away"];

/** A decomposição com o motivo da recusa (testes e o aviso). */
export function weighPickDetailed(args: WeighArgs): WeighResult {
  const { base, rho, multipliers, finalRaw } = args;
  let inputs = args.inputs;
  if (!inputs) {
    if (!isIdentity(multipliers)) return { ok: false, reason: "no_factors" };
    inputs = {
      factors: [],
      applied: { home: 1, away: 1 },
      product: { home: 1, away: 1 },
    };
  }

  // Direção: o fator tem de empurrar pro lado da frase dele (R3). Pega linha antiga com a
  // regra simétrica, onde um "não" (noul < 0,5) mexia no λ ao contrário.
  for (const f of inputs.factors) {
    const factor = factorOf(f.key);
    if (!factor || !(f.value > NEUTRAL))
      return { ok: false, reason: "factor_direction" };
    if (
      Math.sign(f.multiplier - 1) !== Math.sign(factorMultiplier(factor, 1) - 1)
    ) {
      return { ok: false, reason: "factor_direction" };
    }
  }

  // Corte proporcional do clamp, em log, por lado (sempre em ordem canônica: a soma em
  // ponto flutuante não pode depender da ordem do jsonb).
  const canonical = [...inputs.factors].sort(
    (a, b) =>
      canonicalRank(a.key) - canonicalRank(b.key) || a.key.localeCompare(b.key)
  );
  const scale: Pair = { home: 1, away: 1 };
  const clamped = { home: false, away: false };
  for (const side of SIDES) {
    const L = canonical
      .filter((f) => f.lambdaSide === side)
      .reduce((acc, f) => acc + Math.log(f.multiplier), 0);
    // Os fatores lidos têm de ser TODOS os que entraram no produto: um fator gravado que
    // a leitura não conhece (chave nova, renomeada) teria o efeito dele repassado aos
    // outros pelo corte do clamp.
    if (!(Math.abs(L - Math.log(inputs.product[side])) <= 1e-9)) {
      return { ok: false, reason: "multiplier_mismatch" };
    }
    const A = Math.log(inputs.applied[side]);
    if (Math.abs(L - A) <= 1e-9) continue;
    // O clamp só encolhe: 0 < A/L < 1. Fora disso a conta inventaria efeito (> 1) ou
    // inverteria a direção dos fatores (< 0).
    const s = A / L;
    if (!(s > 0 && s < 1)) return { ok: false, reason: "clamp" };
    scale[side] = s;
    clamped[side] = true;
  }
  const effective = canonical.map((f) => ({
    ...f,
    multiplier: clamped[f.lambdaSide]
      ? Math.exp(scale[f.lambdaSide] * Math.log(f.multiplier))
      : f.multiplier,
  }));

  // O produto efetivo tem de ser o multiplicador do pick.
  const target = multipliers ?? { home: 1, away: 1 };
  for (const side of SIDES) {
    const prod = effective
      .filter((f) => f.lambdaSide === side)
      .reduce((acc, f) => acc * f.multiplier, 1);
    if (!(Math.abs(prod / target[side] - 1) <= 1e-6)) {
      return { ok: false, reason: "multiplier_mismatch" };
    }
  }

  // Sequência sobre a matriz, na ordem de exibição.
  const ordered = orderFactors(effective);
  const lambda = { ...base };
  const p0 = probsOf(lambda, rho);
  const steps: OutcomeTriple[] = [];
  let prev = p0;
  for (const f of ordered) {
    lambda[f.lambdaSide] *= f.multiplier;
    const p = probsOf(lambda, rho);
    steps.push(triple((k) => (p[k] - prev[k]) * 100));
    prev = p;
  }
  if (OUTCOMES.some((k) => !(Math.abs(prev[k] - finalRaw[k]) < 1e-6))) {
    return { ok: false, reason: "sequence_mismatch" };
  }

  // Inteiros: base e palpite somam 100; cada fator soma 0; cada coluna fecha com
  // palpite − base; e nenhum ponto contradiz o sinal do cru, nos TRÊS resultados.
  const lr = (p: OutcomeTriple) => {
    const [home, draw, away] = largestRemainder(
      OUTCOMES.map((k) => p[k] * 100),
      100
    );
    return { home, draw, away };
  };
  const basePts = lr(p0);
  const finalPts = lr(finalRaw);
  // O cru entra como o `pp` gravado (2 casas): um efeito de 0,004 pp conta como zero e
  // não leva ponto, e o sinal de `pts` confere com o de `pp` em qualquer auditoria.
  const pts = apportionTable(
    steps.map((s) => OUTCOMES.map((k) => round(s[k], 2))),
    OUTCOMES.map((k) => finalPts[k] - basePts[k])
  );
  if (!pts) return { ok: false, reason: "rounding_conflict" };

  return {
    ok: true,
    weighed: {
      version: PALPITE_WEIGHED_VERSION,
      baseProbs: triple((k) => round(p0[k] * 100, 2)),
      baseOutcome: mostLikelyOutcome(p0),
      basePts,
      finalPts,
      factors: ordered.map((f, i) => ({
        key: f.key,
        lambdaSide: f.lambdaSide,
        origin: f.origin,
        value: round(f.value, 2),
        multiplier: round(f.multiplier, 6),
        pp: triple((k) => round(steps[i][k], 2)),
        pts: { home: pts[i][0], draw: pts[i][1], away: pts[i][2] },
      })),
      clamped,
    },
  };
}

/** A decomposição gravada no pick; null (com aviso) quando não fecha. */
export function weighPick(args: WeighArgs): PalpiteWeighed | null {
  let r: WeighResult;
  try {
    r = weighPickDetailed(args);
  } catch {
    // Entrada torta que escapou das conferências: o palpite sai sem o bloco.
    console.warn({ scope: "palpite_weighed", reason: "error" });
    return null;
  }
  if (r.ok) return r.weighed;
  console.warn({ scope: "palpite_weighed", reason: r.reason });
  return null;
}
