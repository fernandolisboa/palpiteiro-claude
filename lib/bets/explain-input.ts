import type { BetLegParams } from "@/db/schema";
import { judgmentFactorPhrases } from "@/lib/ai/markets/_narrator/labels";
import { legMarketPin } from "@/lib/bets/slip-markets";
import type { UserBetSlipRow } from "@/lib/db/queries/user-bets";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
  MIN_EDGE_PP,
} from "@/lib/odds/scenario";
import {
  slipLegLabel,
  valueReadingKind,
  type TeamNames,
  type ValueReadingKind,
} from "@/lib/view/bet-slip";

// Entrada do "Explicar com IA" (#562, ADR 0063), montada SÓ das rows congeladas do
// registro (bet_slips/bet_legs) e da base do jogo que avaliou as pernas
// (`bet_slips.model_snapshot_id`). Nunca reavalia: a base muda a cada 6h e o texto tem
// que bater com o que o painel mostrou (mesmo princípio de historyLegView). Pura.

export type ExplainLegSource =
  | "analysis"
  | "dixon_coles"
  | "heuristic"
  | "model";

export type ExplainLeg = {
  // Posição entre as pernas explicadas (só as avaliadas), na ordem do registro.
  index: number;
  label: string;
  // Perna de combinada: sem odd nem stake próprios (são da combinada).
  inCombo: boolean;
  modelProbPct: number;
  fairOdd: number | null;
  userOdd: number | null;
  breakEvenPct: number | null;
  // Retorno esperado em % (fração × 100) na odd do usuário; null sem odd.
  evPct: number | null;
  // Veredito do código pelo sinal do EV; null na perna de combinada.
  reading: ValueReadingKind | null;
  source: ExplainLegSource;
  reference: {
    odd: number;
    impliedPct: number;
    edgePp: number;
    floorPp: number;
    belowFloor: boolean;
  } | null;
  // A odd de referência e a sua odd contam histórias opostas (edge e EV com sinais
  // diferentes): o veredito segue a sua odd.
  coherenceWarning: boolean;
  suggestedStakeUnits: number | null;
  userStakeUnits: number | null;
};

export type ExplainCombo = {
  jointProbPct: number;
  fairOdd: number | null;
  userOdd: number | null;
  breakEvenPct: number | null;
  evPct: number | null;
  reading: ValueReadingKind;
  userStakeUnits: number | null;
};

// O que a base do jogo diz do JEV. null quando nenhuma perna veio do modelo de placar.
export type ExplainJev =
  | { kind: "applied"; phrases: string[] }
  | { kind: "no_change" }
  | { kind: "not_attempted" }
  | { kind: "failed" }
  // Sem base no registro: o modelo foi calculado na hora, sem JEV.
  | { kind: "no_base" };

export type BetExplainInput = {
  teams: TeamNames;
  competition: string;
  kickoffLabel: string;
  mode: "simples" | "combinada";
  legs: ExplainLeg[];
  combo: ExplainCombo | null;
  // Motor do modelo de placar das pernas que vieram dele (null se nenhuma).
  scorelineSource: "dixon_coles" | "heuristic" | null;
  jev: ExplainJev | null;
  // Linhas de gols das pernas (2,5 em "Mais de 2,5 gols"): números que o texto pode
  // repetir sem serem odds.
  lines: number[];
};

const num = (v: string | null): number | null =>
  v === null ? null : Number(v);

function evPct(probPct: number, odd: number | null): number | null {
  return odd !== null && odd > 1 ? computeEvPerUnit(probPct, odd) * 100 : null;
}

function breakEven(odd: number | null): number | null {
  return odd !== null && odd > 1 ? computeBreakEvenProbPct(odd) : null;
}

function legSource(leg: UserBetSlipRow["legs"][number]): ExplainLegSource {
  if (leg.gradeSource === "cartridge") return "analysis";
  return leg.modelSource ?? "model";
}

function lineOf(params: BetLegParams): number | null {
  const line = (params as Record<string, unknown>).line;
  const n =
    typeof line === "number"
      ? line
      : typeof line === "string"
        ? Number(line)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

function jevFrom(
  snapshot: MatchModelSnapshot | null,
  teams: TeamNames
): ExplainJev {
  if (snapshot === null) return { kind: "no_base" };
  if (snapshot.jevStatus === "not_attempted") return { kind: "not_attempted" };
  if (snapshot.jevStatus === "failed") return { kind: "failed" };
  const j = snapshot.judgments;
  const phrases = j?.applied
    ? judgmentFactorPhrases(j.answers, j.multipliers, teams)
    : [];
  return phrases.length > 0
    ? { kind: "applied", phrases }
    : { kind: "no_change" };
}

/**
 * Slips de UM registro (na ordem do registro) → entrada da explicação. Só pernas
 * avaliadas (`graded` com chance gravada) entram; registro ao vivo nunca chega aqui
 * (a action recusa antes).
 */
export function buildBetExplainInput(args: {
  slips: readonly UserBetSlipRow[];
  teams: TeamNames;
  competition: string;
  kickoffLabel: string;
  // A base gravada em `bet_slips.model_snapshot_id` (null: calculado na hora).
  snapshot: MatchModelSnapshot | null;
}): BetExplainInput {
  const { slips, teams } = args;
  const mode = slips[0]?.mode === "combinada" ? "combinada" : "simples";
  const legs: ExplainLeg[] = [];
  const lines: number[] = [];
  let scorelineSource: BetExplainInput["scorelineSource"] = null;
  let usesScoreline = false;

  for (const slip of slips) {
    const inCombo = slip.mode === "combinada";
    for (const leg of slip.legs) {
      const prob = num(leg.modelProbPct);
      if (leg.gradeStatus !== "graded" || prob === null) continue;
      const line = lineOf(leg.params);
      if (line !== null) lines.push(line);
      const source = legSource(leg);
      if (leg.gradeSource === "scoreline_model") {
        usesScoreline = true;
        if (leg.modelSource) scorelineSource = leg.modelSource;
      }
      const odd = inCombo ? null : num(leg.userOdd);
      const ev = evPct(prob, odd);
      const implied = num(leg.marketImpliedPct);
      const refOdd = num(leg.referenceOdd);
      const pin = legMarketPin(leg.kind, leg.params);
      const floorPp =
        (pin ? getDescriptor(pin.dbMarketKey)?.minEdgePp : undefined) ??
        MIN_EDGE_PP;
      const reference =
        implied !== null && refOdd !== null
          ? {
              odd: refOdd,
              impliedPct: implied,
              edgePp: prob - implied,
              floorPp,
              belowFloor: prob - implied < floorPp,
            }
          : null;
      legs.push({
        index: legs.length,
        label: slipLegLabel(leg.kind, leg.params, teams),
        inCombo,
        modelProbPct: prob,
        fairOdd: prob > 0 ? 100 / prob : null,
        userOdd: odd,
        breakEvenPct: breakEven(odd),
        evPct: ev,
        reading: inCombo
          ? null
          : valueReadingKind(ev === null ? null : ev / 100),
        source,
        reference,
        coherenceWarning:
          reference !== null &&
          ev !== null &&
          Math.sign(reference.edgePp) !== 0 &&
          Math.sign(ev) !== 0 &&
          Math.sign(reference.edgePp) !== Math.sign(ev),
        suggestedStakeUnits: inCombo ? null : num(leg.suggestedStakeUnits),
        userStakeUnits: inCombo ? null : num(leg.stakeUnits),
      });
    }
  }

  const comboSlip = mode === "combinada" ? slips[0] : undefined;
  const joint = comboSlip ? num(comboSlip.jointProbPct) : null;
  let combo: ExplainCombo | null = null;
  if (comboSlip && joint !== null) {
    // A conjunta sai da matriz do modelo de placar (pernas da sua análise entram pela
    // marginal da matriz na combinada): o JEV da base vale pra ela.
    usesScoreline = true;
    const odd = num(comboSlip.comboUserOdd);
    const ev = evPct(joint, odd);
    combo = {
      jointProbPct: joint,
      fairOdd: joint > 0 ? 100 / joint : null,
      userOdd: odd,
      breakEvenPct: breakEven(odd),
      evPct: ev,
      reading: valueReadingKind(ev === null ? null : ev / 100),
      userStakeUnits: num(comboSlip.stakeUnits),
    };
  }

  return {
    teams,
    competition: args.competition,
    kickoffLabel: args.kickoffLabel,
    mode,
    legs,
    combo,
    scorelineSource:
      scorelineSource ??
      (usesScoreline ? (args.snapshot?.lambdaSource ?? null) : null),
    jev: usesScoreline ? jevFrom(args.snapshot, teams) : null,
    lines,
  };
}
