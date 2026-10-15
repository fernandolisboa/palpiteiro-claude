import type { BetLegParams } from "@/db/schema";
import {
  computeMatchLambdas,
  type MatchLambdas,
} from "@/lib/providers/sports-data/match-lambdas";
import { isInPlayScoreline } from "@/lib/quant/in-play";
import type {
  ModelScoreline,
  ModelScorelineSource,
} from "@/lib/quant/match-model";
import {
  firstHalfScorelineMatrix,
  firstToScoreProbs,
  jointProbability,
  p1X2,
  pBtts,
  pCleanSheet,
  pMarginAtLeast,
  pOverUnder,
  pScoreline,
} from "@/lib/quant/scoreline-model";

// `computeMatchLambdas` (adapter NormalizedStanding→λ) foi PROMOVIDO pra
// lib/providers/sports-data/match-lambdas.ts (ADR 0037) — compartilhado com o
// predict.ts step-6. Re-exportado aqui pra não quebrar call-sites/testes existentes.
export { computeMatchLambdas };
export type { MatchLambdas };

// Engine do CAMINHO B (ADR 0036, Decisão 3): precifica QUALQUER predicado de placar
// sobre o modelo de placar do jogo. Recebe o `ModelScoreline` já resolvido pelo caller
// (getModelScoreline, ADR 0051: Dixon-Coles com o heurístico da tabela como rede, o
// MESMO da análise do jogo, #547) e roteia o kind pro reader certo. Puro e testável.

// Kinds que o CAMINHO B precifica (props sempre + kinds de mercado quando falham o
// gate). cards/corners NÃO entram (Decisão 3: none).
export type ScorelineKind =
  | "exact_score"
  | "margin"
  | "clean_sheet"
  | "first_half_score"
  | "first_half_over_under"
  | "first_to_score"
  | "over_under"
  | "match_result"
  | "btts"
  | "double_chance";

export type ScorelineGrade =
  | {
      status: "graded";
      modelProbPct: number;
      degradedData: boolean;
      source: ModelScorelineSource;
    }
  | { status: "no_data" };


// Kinds que recalculam do λ em vez de ler a matriz: com o modelo em jogo (a matriz
// condicionada ao placar, λ = gols esperados no fim) os dois sairiam errados, então
// ficam fora do ao vivo (#591, PLAN-580 §6.5/R3).
const LAMBDA_READER_KINDS: ReadonlySet<ScorelineKind> = new Set([
  "first_half_score",
  "first_half_over_under",
  "first_to_score",
]);

// Preço (0-1) de um kind sobre o modelo do jogo. Matriz cheia do modelo (ρ do fit no
// DC) + (lazy) matriz de 1º tempo via time-share κ com o MESMO ρ (ausente no heurístico
// → ρ pinado, como antes). Params já validado pelo boundary (switch fechado). null =
// não precifica (leitor do λ sobre o modelo em jogo).
function priceLeg(
  model: ModelScoreline,
  kind: ScorelineKind,
  params: BetLegParams,
): number | null {
  if (isInPlayScoreline(model) && LAMBDA_READER_KINDS.has(kind)) return null;
  const p = params as Record<string, unknown>;
  const fullMatrix = model.matrix;
  const firstHalf = () =>
    firstHalfScorelineMatrix(model.lambdaHome, model.lambdaAway, {
      rho: model.rho,
    });
  switch (kind) {
    case "exact_score":
      return pScoreline(fullMatrix, Number(p.home), Number(p.away));
    case "margin":
      return pMarginAtLeast(
        fullMatrix,
        p.side as "home" | "away",
        Number(p.minMargin),
      );
    case "clean_sheet":
      return pCleanSheet(fullMatrix, p.side as "home" | "away");
    case "over_under": {
      const over = pOverUnder(fullMatrix, Number(p.line));
      return p.selection === "over" ? over : 1 - over;
    }
    case "match_result": {
      const r = p1X2(fullMatrix);
      return r[p.selection as "home" | "draw" | "away"];
    }
    case "btts": {
      const yes = pBtts(fullMatrix);
      return p.selection === "yes" ? yes : 1 - yes;
    }
    case "double_chance": {
      const r = p1X2(fullMatrix);
      const sel = p.selection as "home_draw" | "home_away" | "draw_away";
      if (sel === "home_draw") return r.home + r.draw;
      if (sel === "home_away") return r.home + r.away;
      return r.draw + r.away;
    }
    case "first_half_score": {
      return pScoreline(firstHalf(), Number(p.home), Number(p.away));
    }
    case "first_half_over_under": {
      const over = pOverUnder(firstHalf(), Number(p.line));
      return p.selection === "over" ? over : 1 - over;
    }
    case "first_to_score": {
      const fts = firstToScoreProbs(model.lambdaHome, model.lambdaAway);
      return fts[p.firstToScore as "home" | "away" | "none"];
    }
  }
}

// `model` null = nem DC utilizável nem tabela → sem número (no_data).
export function gradeScorelineLeg(args: {
  model: ModelScoreline | null;
  kind: ScorelineKind;
  params: BetLegParams;
}): ScorelineGrade {
  const { model } = args;
  if (model === null) return { status: "no_data" };

  const prob = priceLeg(model, args.kind, args.params);
  if (prob === null) return { status: "no_data" };
  return {
    status: "graded",
    modelProbPct: prob * 100,
    degradedData: model.degraded,
    source: model.source,
  };
}

// ── Combinada same-game via joint-sum (ADR 0036, Decisão 4, Fase 3 #473) ─────
// A conjunta vem SEMPRE de UMA distribuição coerente — a matriz do modelo. Cada perna
// vira UM predicado sobre o PLACAR FINAL (h,a) que ESPELHA EXATAMENTE o `sumWhere` do
// reader correspondente em scoreline-model.ts — a mesma medida somada só que
// interceptada com as outras. NUNCA multiplicar probs (armadilha de correlação).

export type ScorePredicate = (home: number, away: number) => boolean;

// Predicado sobre o placar final de UMA perna, ou null quando a perna está FORA da
// matriz (1º tempo = matriz-κ própria; first_to_score = processo temporal; cards/
// corners = não-gradeáveis). Qualquer null derruba a combinada pra "não avaliada".
export function legToScorePredicate(
  kind: string,
  params: BetLegParams,
): ScorePredicate | null {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "exact_score": {
      const home = Number(p.home);
      const away = Number(p.away);
      return (h, a) => h === home && a === away;
    }
    case "margin": {
      const side = p.side as "home" | "away";
      const k = Number(p.minMargin);
      return (h, a) => (side === "home" ? h - a >= k : a - h >= k);
    }
    case "clean_sheet": {
      const side = p.side as "home" | "away";
      return (h, a) => (side === "home" ? a === 0 : h === 0);
    }
    case "over_under": {
      const line = Number(p.line);
      // Espelha pOverUnder (h+a > line, `>` estrito). under = complemento.
      return p.selection === "over"
        ? (h, a) => h + a > line
        : (h, a) => !(h + a > line);
    }
    case "match_result": {
      const sel = p.selection as "home" | "draw" | "away";
      if (sel === "home") return (h, a) => h > a;
      if (sel === "draw") return (h, a) => h === a;
      return (h, a) => a > h;
    }
    case "btts": {
      // yes = h>=1 && a>=1 (espelha pBtts); no = complemento.
      return p.selection === "yes"
        ? (h, a) => h >= 1 && a >= 1
        : (h, a) => !(h >= 1 && a >= 1);
    }
    case "double_chance": {
      // home_draw = home+draw = h>=a; home_away = home+away = h!==a;
      // draw_away = draw+away = a>=h (espelha p1X2 somado).
      const sel = p.selection as "home_draw" | "home_away" | "draw_away";
      if (sel === "home_draw") return (h, a) => h >= a;
      if (sel === "home_away") return (h, a) => h !== a;
      return (h, a) => a >= h;
    }
    // FORA da matriz — derrubam a combinada pra "não avaliada".
    case "first_half_score":
    case "first_half_over_under":
    case "first_to_score":
    case "cards":
    case "corners":
      return null;
    default:
      return null;
  }
}

export type SlipJoint = {
  jointProbPct: number; // P(todas as pernas) × 100, da matriz do slip
  marginalsPct: number[]; // marginal de CADA perna, MESMA matriz (joint ≤ min)
  degradedData: boolean;
  source: ModelScorelineSource;
};

// Computa a conjunta do slip sobre a matriz do jogo. Recebe as pernas JÁ sabidas com
// predicado não-null (o caller gateia); retorna null quando não há modelo (sem DC
// utilizável e tabela indisponível/degenerada) OU alguma perna mapeia null (defesa em
// profundidade). As marginais saem da MESMA matriz (nunca do modelProbPct persistido,
// que pra Caminho A é o número do cartucho — fonte diferente) → joint ≤ min garantido.
export function computeSlipJoint(args: {
  model: ModelScoreline | null;
  legs: Array<{ kind: string; params: BetLegParams }>;
}): SlipJoint | null {
  const { model } = args;
  if (model === null) return null;

  const preds = args.legs.map((l) => legToScorePredicate(l.kind, l.params));
  if (preds.some((pr) => pr === null)) return null;
  const predicates = preds as ScorePredicate[];

  const matrix = model.matrix;
  return {
    jointProbPct: jointProbability(matrix, predicates) * 100,
    marginalsPct: predicates.map((pr) => jointProbability(matrix, [pr]) * 100),
    degradedData: model.degraded,
    source: model.source,
  };
}
