import type { BetLegParams } from "@/db/schema";
import { computeKellyStakeUnits, computeStakeUnits, KELLY_FRACTION } from "@/lib/ai/staking";
import type { AnalysisMarket } from "@/lib/bets/analysis-probs";
import {
  computeSlipJoint,
  gradeScorelineLeg,
  legToScorePredicate,
  type ScorelineKind,
} from "@/lib/bets/grade-scoreline";
import { legMarketPin, referenceKey, type MarketPin } from "@/lib/bets/slip-markets";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
  computeMarketScenarios,
  MIN_EDGE_PP,
} from "@/lib/odds/scenario";
import { isInPlayScoreline } from "@/lib/quant/in-play";
import type { ModelScoreline, ModelScorelineSource } from "@/lib/quant/match-model";
import {
  outcomesFromScoreMatrix,
  simultaneousKellyFractions,
} from "@/lib/quant/simultaneous-kelly";

// Avaliação PURA das apostas registradas (Fase 2, #556): tudo em código, sem LLM. Por
// perna: probabilidade (a da sua análise daquele mercado quando existe, senão o modelo
// de placar do jogo), odd justa, retorno esperado na odd do usuário, edge contra o
// mercado de-vigado (só com captura COMPLETA daquele mercado — nunca 1/odd cru,
// CLAUDE.md) e stake sugerido.
//
// Stake: as bandas do ADR 0019 são o número oficial; o quarter-Kelly aparece como
// informativo. O gate do Kelly (ADR 0039) valida as recomendações da análise, não
// apostas escolhidas pelo usuário (placar exato, combinadas), então não é reaproveitado
// aqui. Nenhum stake com EV ≤ 0 (as bandas dariam 1u até pra aposta sem valor), e a
// soma por jogo respeita o teto de 3u das bandas. Em "Simples" com 2+ pernas de valor,
// o Kelly informativo é o SIMULTÂNEO (sobre a matriz), que não soma apostas
// correlacionadas como se fossem independentes.

export type SlipMode = "simples" | "combinada";

export type SlipLegInput = {
  kind: string;
  params: BetLegParams;
  userOdd: number | null;
  stakeUnits: number | null;
};

// Última captura completa de um mercado (ou linha de over/under) pra este jogo.
export type ReferenceMarket = {
  bookmaker: string;
  capturedAt: Date;
  odds: Record<string, number>;
};
export type ReferenceOdds = ReadonlyMap<string, ReferenceMarket>;

export type StakeRule = "bandas" | "quarter-kelly" | "quarter-kelly-conjunto";
export type StakeSuggestion = { units: number; rule: StakeRule };

// Teto de exposição num jogo (o mesmo teto de 3u das bandas, ADR 0019).
export const MATCH_STAKE_CAP_UNITS = 3;

export type GradedLeg = {
  status: "graded";
  kind: string;
  params: BetLegParams;
  userOdd: number | null;
  stakeUnits: number | null;
  modelProbPct: number;
  // "analysis" = probabilidade da sua análise daquele mercado; "model" = modelo de placar.
  origin: "analysis" | "model";
  predictionId: string | null;
  fairOdd: number | null;
  // Motor da matriz do jogo (null quando o número veio da análise).
  source: ModelScorelineSource | null;
  degradedData: boolean;
  reference: {
    odd: number;
    bookmaker: string;
    capturedAt: Date;
    impliedPct: number;
    edgePct: number;
  } | null;
  evPerUnit: number | null;
  breakEvenProbPct: number | null;
  // Edge medido e abaixo do piso do motor (a análise não recomendaria essa seleção).
  belowEdgeFloor: boolean;
  // Edge contra o mercado e retorno na sua odd com sinais opostos: o veredito segue a
  // sua odd (ADR 0034 §4c).
  coherenceWarning: boolean;
  suggestedStake: StakeSuggestion | null;
  kellyInfo: StakeSuggestion | null;
};

export type EvaluatedLeg =
  | GradedLeg
  | {
      status: "no_data" | "not_covered";
      kind: string;
      params: BetLegParams;
      userOdd: number | null;
      stakeUnits: number | null;
    };

export type EvaluatedCombo =
  | {
      status: "graded";
      jointProbPct: number;
      marginalsPct: number[];
      fairOdd: number | null;
      source: ModelScorelineSource;
      degradedData: boolean;
      comboUserOdd: number | null;
      comboStakeUnits: number | null;
      evPerUnit: number | null;
      breakEvenProbPct: number | null;
      suggestedStake: StakeSuggestion | null;
      kellyInfo: StakeSuggestion | null;
    }
  | { status: "not_evaluated"; reason: "fora-da-matriz" | "sem-modelo" };

export type SlipEvaluation = {
  mode: SlipMode;
  legs: EvaluatedLeg[];
  combo: EvaluatedCombo | null;
  // A soma dos stakes sugeridos passou do teto por jogo e foi reduzida.
  cappedAtMatchLimit: boolean;
  // false = nenhum stake sugerido nem Kelly informativo (ao vivo: o modelo em jogo não
  // tem calibração, ADR 0060 emenda à 0053 §5-6).
  suggestStake: boolean;
  // A chance veio do modelo em jogo (InPlayScoreline): a tela diz "modelo ao vivo".
  inPlay: boolean;
};

const NONE_KINDS = new Set(["cards", "corners"]);

const round2 = (n: number) => Number(n.toFixed(2));

function referenceFor(
  probPct: number,
  pin: MarketPin | null,
  references: ReferenceOdds,
): GradedLeg["reference"] {
  if (!pin) return null;
  const ref = references.get(referenceKey(pin));
  const descriptor = getDescriptor(pin.dbMarketKey);
  if (!ref || !descriptor) return null;
  // Mercado COMPLETO ou nada: de-vig sobre parte do mercado distorce o overround.
  const keys = descriptor.selectionKeys;
  if (keys.length === 0 || keys.some((k) => !(ref.odds[k] > 1))) return null;
  // O edge da seleção só depende da prob dela e da implícita (que só depende das
  // odds); as outras seleções entram sem prob só pra completar o mercado.
  const scen = computeMarketScenarios({
    selections: keys.map((k) => ({
      key: k,
      modelProbPct: k === pin.selectionKey ? probPct : null,
      odd: ref.odds[k],
    })),
    recommendedKey: null,
    impliedSumTarget: descriptor.impliedSumTarget ?? 1,
    marketKind: descriptor.marketKind ?? "partition",
  });
  const sel = scen.selections.find((s) => s.key === pin.selectionKey);
  if (!sel || sel.impliedProbPct === null || sel.edgePct === null) return null;
  return {
    odd: ref.odds[pin.selectionKey],
    bookmaker: ref.bookmaker,
    capturedAt: ref.capturedAt,
    impliedPct: round2(sel.impliedProbPct),
    edgePct: round2(sel.edgePct),
  };
}

function quarterKellyUnits(fullFraction: number): number {
  return Math.round(KELLY_FRACTION * fullFraction * 100 * 2) / 2;
}

// Stake de uma aposta isolada. Só com odd e EV > 0: o motor não dimensiona aposta sem
// valor. Bandas = oficial; quarter-Kelly = informativo.
function singleStake(
  probPct: number,
  odd: number | null,
  edgePct: number | null,
): { suggested: StakeSuggestion | null; info: StakeSuggestion | null } {
  if (odd === null || computeEvPerUnit(probPct, odd) <= 0) {
    return { suggested: null, info: null };
  }
  const kelly = computeKellyStakeUnits(probPct / 100, odd);
  return {
    suggested: { units: computeStakeUnits(edgePct, probPct), rule: "bandas" },
    info: kelly === null ? null : { units: kelly, rule: "quarter-kelly" },
  };
}

// Leva a soma ao teto por jogo: reduz proporcionalmente em degraus de 0.5u e devolve o
// que o arredondamento pra baixo tirou às pernas com a maior sobra (maiores restos), sem
// passar do stake original nem do teto. Um stake que fica em 0 vira null (o motor não
// apostaria nessa perna dentro do teto).
function capTotal(stakes: Array<StakeSuggestion | null>): {
  stakes: Array<StakeSuggestion | null>;
  capped: boolean;
} {
  const total = stakes.reduce((s, x) => s + (x?.units ?? 0), 0);
  if (total <= MATCH_STAKE_CAP_UNITS) return { stakes, capped: false };
  const factor = MATCH_STAKE_CAP_UNITS / total;
  const scaled = stakes.map((s) => (s === null ? 0 : s.units * factor));
  const units = scaled.map((x) => Math.floor(x * 2) / 2);
  let left = MATCH_STAKE_CAP_UNITS - units.reduce((a, b) => a + b, 0);
  const byRemainder = scaled
    .map((x, i) => ({ i, rest: x - units[i] }))
    .filter(({ i }) => stakes[i] !== null)
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left < 0.5) break;
    if (units[i] + 0.5 > stakes[i]!.units) continue;
    units[i] += 0.5;
    left -= 0.5;
  }
  return {
    capped: true,
    stakes: stakes.map((s, i) =>
      s === null || units[i] <= 0 ? null : { ...s, units: units[i] },
    ),
  };
}

export function evaluateSlip(input: {
  mode: SlipMode;
  legs: SlipLegInput[];
  model: ModelScoreline | null;
  references: ReferenceOdds;
  analysis: ReadonlyMap<string, AnalysisMarket>;
  comboUserOdd: number | null;
  comboStakeUnits: number | null;
  // Default true. false (ao vivo): sem banda nem Kelly, só chance, odd justa e EV.
  suggestStake?: boolean;
}): SlipEvaluation {
  const { model } = input;
  const suggestStake = input.suggestStake ?? true;
  const inPlay = model !== null && isInPlayScoreline(model);
  const evaluation = evaluateWithStakes(input);
  if (suggestStake) return { ...evaluation, suggestStake, inPlay };
  for (const leg of evaluation.legs) {
    if (leg.status !== "graded") continue;
    leg.suggestedStake = null;
    leg.kellyInfo = null;
  }
  const combo =
    evaluation.combo?.status === "graded"
      ? { ...evaluation.combo, suggestedStake: null, kellyInfo: null }
      : evaluation.combo;
  return { ...evaluation, combo, cappedAtMatchLimit: false, suggestStake, inPlay };
}

function evaluateWithStakes(
  input: Parameters<typeof evaluateSlip>[0],
): Omit<SlipEvaluation, "suggestStake" | "inPlay"> {
  const { model, references, analysis } = input;

  const legs: EvaluatedLeg[] = input.legs.map((leg): EvaluatedLeg => {
    const base = {
      kind: leg.kind,
      params: leg.params,
      userOdd: leg.userOdd,
      stakeUnits: leg.stakeUnits,
    };
    if (NONE_KINDS.has(leg.kind)) return { status: "not_covered", ...base };

    const pin = legMarketPin(leg.kind, leg.params);
    const fromAnalysis = pin ? analysis.get(referenceKey(pin)) : undefined;
    const analysisProb = pin ? fromAnalysis?.probs[pin.selectionKey] : undefined;

    let modelProbPct: number;
    let origin: GradedLeg["origin"];
    let source: ModelScorelineSource | null = null;
    let degradedData = false;
    if (analysisProb !== undefined && fromAnalysis) {
      modelProbPct = analysisProb;
      origin = "analysis";
    } else {
      const grade = gradeScorelineLeg({
        model,
        kind: leg.kind as ScorelineKind,
        params: leg.params,
      });
      if (grade.status === "no_data") return { status: "no_data", ...base };
      modelProbPct = grade.modelProbPct;
      origin = "model";
      source = grade.source;
      degradedData = grade.degradedData;
    }

    const reference = referenceFor(modelProbPct, pin, references);
    const minEdge =
      (pin ? getDescriptor(pin.dbMarketKey)?.minEdgePp : undefined) ?? MIN_EDGE_PP;
    const evPerUnit =
      leg.userOdd === null ? null : computeEvPerUnit(modelProbPct, leg.userOdd);
    // Na combinada o stake é da combinada inteira: perna não ganha stake sugerido.
    const stake =
      input.mode === "simples"
        ? singleStake(modelProbPct, leg.userOdd, reference?.edgePct ?? null)
        : { suggested: null, info: null };
    return {
      status: "graded",
      ...base,
      modelProbPct,
      origin,
      predictionId: origin === "analysis" ? (fromAnalysis?.predictionId ?? null) : null,
      fairOdd: modelProbPct > 0 ? 100 / modelProbPct : null,
      source,
      degradedData,
      reference,
      evPerUnit,
      breakEvenProbPct:
        leg.userOdd === null ? null : computeBreakEvenProbPct(leg.userOdd),
      belowEdgeFloor: reference !== null && reference.edgePct < minEdge,
      coherenceWarning:
        reference !== null &&
        evPerUnit !== null &&
        Math.sign(reference.edgePct) !== 0 &&
        Math.sign(evPerUnit) !== 0 &&
        Math.sign(reference.edgePct) !== Math.sign(evPerUnit),
      suggestedStake: stake.suggested,
      kellyInfo: stake.info,
    };
  });

  if (input.mode === "simples") {
    applyJointKelly(legs, model);
    const graded = legs.filter((l): l is GradedLeg => l.status === "graded");
    const suggested = capTotal(graded.map((l) => l.suggestedStake));
    const info = capTotal(graded.map((l) => l.kellyInfo));
    graded.forEach((l, i) => {
      l.suggestedStake = suggested.stakes[i];
      l.kellyInfo = info.stakes[i];
    });
    return {
      mode: "simples",
      legs,
      combo: null,
      // A nota fala do stake sugerido (bandas); o Kelly informativo também é
      // limitado, sem aviso próprio.
      cappedAtMatchLimit: suggested.capped,
    };
  }
  return {
    mode: "combinada",
    legs,
    combo: evaluateCombo(input, legs),
    cappedAtMatchLimit: false,
  };
}

// Kelly simultâneo (Simples com 2+ pernas de valor na matriz): troca o quarter-Kelly
// informativo de cada uma pelo conjunto. A matriz é a do jogo mesmo quando a prob da
// perna veio da análise (as duas só diferem pelo ajuste do JEV). Pernas fora da matriz
// (1º tempo, quem marca primeiro) ficam com o Kelly individual.
function applyJointKelly(legs: EvaluatedLeg[], model: ModelScoreline | null): void {
  if (model === null) return;
  const idx: number[] = [];
  const predicates: Array<(h: number, a: number) => boolean> = [];
  const odds: number[] = [];
  legs.forEach((leg, i) => {
    if (leg.status !== "graded" || leg.userOdd === null) return;
    if (leg.evPerUnit === null || leg.evPerUnit <= 0) return;
    const pred = legToScorePredicate(leg.kind, leg.params);
    if (!pred) return;
    idx.push(i);
    predicates.push(pred);
    odds.push(leg.userOdd);
  });
  if (idx.length < 2) return;
  const fractions = simultaneousKellyFractions(
    outcomesFromScoreMatrix(model.matrix.cells, predicates),
    odds,
  );
  if (!fractions) return;
  idx.forEach((legIndex, j) => {
    const leg = legs[legIndex];
    if (leg.status !== "graded") return;
    const units = quarterKellyUnits(fractions[j]);
    leg.kellyInfo = units > 0 ? { units, rule: "quarter-kelly-conjunto" } : null;
  });
}

// Combinada: a conjunta SEMPRE sai da matriz do jogo (nunca multiplicando as pernas,
// que são correlacionadas), e só com a odd combinada que o usuário informou.
function evaluateCombo(
  input: Parameters<typeof evaluateSlip>[0],
  legs: EvaluatedLeg[],
): EvaluatedCombo {
  if (input.model === null) return { status: "not_evaluated", reason: "sem-modelo" };
  const inMatrix = input.legs.every(
    (l) => legToScorePredicate(l.kind, l.params) !== null,
  );
  if (!inMatrix || legs.some((l) => l.status !== "graded")) {
    return { status: "not_evaluated", reason: "fora-da-matriz" };
  }
  const joint = computeSlipJoint({
    model: input.model,
    legs: input.legs.map((l) => ({ kind: l.kind, params: l.params })),
  });
  if (joint === null) return { status: "not_evaluated", reason: "sem-modelo" };
  const odd = input.comboUserOdd;
  const stake = singleStake(joint.jointProbPct, odd, null);
  return {
    status: "graded",
    jointProbPct: joint.jointProbPct,
    marginalsPct: joint.marginalsPct,
    fairOdd: joint.jointProbPct > 0 ? 100 / joint.jointProbPct : null,
    source: joint.source,
    degradedData: joint.degradedData,
    comboUserOdd: odd,
    comboStakeUnits: input.comboStakeUnits,
    evPerUnit: odd === null ? null : computeEvPerUnit(joint.jointProbPct, odd),
    breakEvenProbPct: odd === null ? null : computeBreakEvenProbPct(odd),
    suggestedStake: stake.suggested,
    kellyInfo: stake.info,
  };
}
