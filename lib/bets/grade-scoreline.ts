import type { BetLegParams } from "@/db/schema";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import {
  computeMatchLambdas,
  type MatchLambdas,
} from "@/lib/providers/sports-data/match-lambdas";
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
  scorelineMatrix,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

// `computeMatchLambdas` (adapter NormalizedStanding→λ) foi PROMOVIDO pra
// lib/providers/sports-data/match-lambdas.ts (ADR 0037) — compartilhado com o
// predict.ts step-6. Re-exportado aqui pra não quebrar call-sites/testes existentes.
export { computeMatchLambdas };
export type { MatchLambdas };

// Engine do CAMINHO B (ADR 0036, Decisão 3): precifica QUALQUER predicado de placar
// pelo modelo double-Poisson. Vive na fronteira do CONSUMIDOR (lib/quant é puro):
// mapeia a tabela do provider pros tipos do modelo, guarda o caso degenerado (B1), e
// roteia o kind pro reader certo. Determinístico e testável (recebe a standing pronta).

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
  | { status: "graded"; modelProbPct: number; degradedData: boolean }
  | { status: "no_data" };


// Preço (0-1) de um kind sobre os λ do jogo. Full matrix + (lazy) matriz de 1º tempo
// via time-share κ. Params já validado pelo boundary (defense-in-depth: switch fechado).
function priceLeg(
  lambdas: MatchLambdas,
  kind: ScorelineKind,
  params: BetLegParams,
  fullMatrix: ScorelineMatrix,
): number {
  const p = params as Record<string, unknown>;
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
      const fh = firstHalfScorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
      return pScoreline(fh, Number(p.home), Number(p.away));
    }
    case "first_half_over_under": {
      const fh = firstHalfScorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
      const over = pOverUnder(fh, Number(p.line));
      return p.selection === "over" ? over : 1 - over;
    }
    case "first_to_score": {
      const fts = firstToScoreProbs(lambdas.lambdaHome, lambdas.lambdaAway);
      return fts[p.firstToScore as "home" | "away" | "none"];
    }
  }
}

export function gradeScorelineLeg(args: {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
  kind: ScorelineKind;
  params: BetLegParams;
}): ScorelineGrade {
  const lambdas = computeMatchLambdas(args);
  if (lambdas === null) return { status: "no_data" };

  const fullMatrix = scorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
  const prob = priceLeg(lambdas, args.kind, args.params, fullMatrix);
  return {
    status: "graded",
    modelProbPct: prob * 100,
    degradedData: lambdas.degradedData,
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
  marginalsPct: number[]; // marginal Poisson de CADA perna, MESMA matriz (joint ≤ min)
  degradedData: boolean;
};

// Computa a conjunta do slip sobre a matriz do jogo. Recebe as pernas JÁ sabidas com
// predicado não-null (o caller gateia); retorna null quando a matriz é incomputável
// (standings indisponível/degenerado) OU alguma perna mapeia null (defesa em
// profundidade). As marginais saem da MESMA matriz (nunca do modelProbPct persistido,
// que pra Caminho A é o número do cartucho — fonte diferente) → joint ≤ min garantido.
export function computeSlipJoint(args: {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
  legs: Array<{ kind: string; params: BetLegParams }>;
}): SlipJoint | null {
  const lambdas = computeMatchLambdas(args);
  if (lambdas === null) return null;

  const preds = args.legs.map((l) => legToScorePredicate(l.kind, l.params));
  if (preds.some((pr) => pr === null)) return null;
  const predicates = preds as ScorePredicate[];

  const matrix = scorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
  return {
    jointProbPct: jointProbability(matrix, predicates) * 100,
    marginalsPct: predicates.map((pr) => jointProbability(matrix, [pr]) * 100),
    degradedData: lambdas.degradedData,
  };
}
