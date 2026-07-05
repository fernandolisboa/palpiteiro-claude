import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
} from "@/lib/odds/scenario";
import { profitForOutcome } from "@/lib/settlement/money";
import type { FreeBetComboView, FreeBetLegView } from "@/lib/view/types";

// Mapper PURO da perna de "aposta livre" gradeada pelo CAMINHO B (modelo de placar,
// ADR 0036, Decisão 3). Roda SERVER-SIDE (chamado pela action confirmBet) e devolve
// um FreeBetLegView de tipos puros — o componente "use client" só recebe o resultado.
// Espelha lib/view/grade-my-bet.ts: importa SÓ @/lib/odds/scenario (EV/break-even) +
// @/lib/settlement/money (lucro) + tipos. NUNCA importa @/lib/db, @/lib/ai nem
// value-language-guard — a superfície Análise renderiza EV/break-even/lucro abertamente
// (legítimo); o firewall da manchete é erro de categoria aqui (ADR 0034 §9 / 0036 §7).
//
// PERNA B NÃO TEM CANAL DE EDGE: sem board de mercado completo não há de-vig (ADR
// 0018) → `edgeLabel` é "—" SEMPRE e é PROIBIDO derivar pseudo-implícita de 1/userOdd
// (o `1/odd` cru que o CLAUDE.md veta — margem de UM book, sem Σ1/odd pra normalizar).
// Por isso este módulo NUNCA importa computeMarketImpliedProbabilities (teste pinado).

export const SETTLE_BADGE_PT_BR = "conferimos após o jogo";

// Veredito TEMPLATE-DERIVADO de sign(EV@userOdd) SÓ (nunca sign de edge — não há
// edge). Descritivo/backward-looking, NUNCA imperativo. Conjunto FINITO (golden test
// pina o render). Espelha VALUE_READING de grade-my-bet.ts, adaptado ao "modelo
// simplificado".
const VALUE_READING = {
  positive:
    "Pelo modelo simplificado, nessa odd, essa aposta tem valor — a probabilidade que estimamos supera o que a odd paga.",
  zero: "Pelo modelo simplificado, nessa odd, essa aposta fica no limite — sem vantagem nem desvantagem clara.",
  negative:
    "Pelo modelo simplificado, nessa odd, essa aposta não tem valor — a odd paga menos do que a probabilidade que estimamos.",
} as const;

function valueReadingForSign(evSign: number): string {
  if (evSign > 0) return VALUE_READING.positive;
  if (evSign < 0) return VALUE_READING.negative;
  return VALUE_READING.zero;
}

type ValueChannel = {
  userOdd: number;
  valueReading: string;
  evPerUnit: number;
  breakEvenProbPct: number;
  profitIfWon: number;
};

export type FreeBetLegMapperInput =
  | {
      status: "graded";
      selectionLabel: string;
      // Congelado, já Number()'do pela action (0-100). NUNCA recomputado no render.
      modelProbPct: number;
      // meta.source === "prior" → rótulo "dados limitados" (degrau ii da escada).
      degradedData: boolean;
      // A odd que o usuário pegou na casa (já validada > 1), ou null se não deu odd.
      userOdd: number | null;
    }
  | { status: "no_data"; selectionLabel: string; reason: string };

export function toFreeBetLegView(input: FreeBetLegMapperInput): FreeBetLegView {
  if (input.status === "no_data") {
    return {
      kind: "nao-avalio",
      selectionLabel: input.selectionLabel,
      reason: input.reason,
    };
  }

  const sourceLabel = input.degradedData
    ? "modelo simplificado (dados limitados)"
    : "modelo simplificado";

  // Canal odd-do-usuário (price-only). EV e break-even saem de chamadas DIRETAS na
  // odd do usuário. NÃO há canal de edge/implícita (perna B) — edgeLabel="—" sempre.
  let value: ValueChannel | null = null;
  if (input.userOdd !== null) {
    const evPerUnit = computeEvPerUnit(input.modelProbPct, input.userOdd);
    value = {
      userOdd: input.userOdd,
      valueReading: valueReadingForSign(Math.sign(evPerUnit)),
      evPerUnit,
      breakEvenProbPct: computeBreakEvenProbPct(input.userOdd),
      profitIfWon: profitForOutcome("won", input.userOdd, 1),
    };
  }

  return {
    kind: "grade-modelo-simplificado",
    selectionLabel: input.selectionLabel,
    sourceLabel,
    modelProbPct: input.modelProbPct,
    edgeLabel: "—",
    settleBadge: SETTLE_BADGE_PT_BR,
    value,
  };
}

// ── Mapper da COMBINADA same-game (joint-sum, #473, ADR 0036 Decisão 4) ──────
// PURO, server-side (chamado por confirmBet e pela view do histórico). O joint e as
// marginais chegam JÁ computados sobre a MESMA matriz (lib/bets/grade-scoreline.ts:
// computeSlipJoint) — este mapper só formata o canal de valor. Mesma disciplina do
// mapper de perna: sem edge, EV só com odd, valueReading template-derivado.
export type FreeBetComboMapperInput =
  | {
      status: "combinada";
      jointProbPct: number;
      degradedData: boolean;
      legs: { selectionLabel: string; marginalPct: number }[];
      comboUserOdd: number | null;
    }
  | { status: "nao-avaliada"; reason: string };

export function toFreeBetComboView(
  input: FreeBetComboMapperInput,
): FreeBetComboView {
  if (input.status === "nao-avaliada") {
    return { kind: "combinada-nao-avaliada", reason: input.reason };
  }

  const sourceLabel = input.degradedData
    ? "modelo simplificado (dados limitados)"
    : "modelo simplificado";

  // EV/break-even/lucro SÓ quando o usuário deu a odd combinada E o joint é computável
  // (este ramo). Sem odd → só a conjunta + marginais (nunca EV parcial — Decisão 4c).
  const comboValue =
    input.comboUserOdd === null
      ? null
      : {
          comboUserOdd: input.comboUserOdd,
          valueReading: valueReadingForSign(
            Math.sign(computeEvPerUnit(input.jointProbPct, input.comboUserOdd)),
          ),
          evPerUnit: computeEvPerUnit(input.jointProbPct, input.comboUserOdd),
          breakEvenProbPct: computeBreakEvenProbPct(input.comboUserOdd),
          profitIfWon: profitForOutcome("won", input.comboUserOdd, 1),
        };

  return {
    kind: "combinada",
    jointProbPct: input.jointProbPct,
    sourceLabel,
    legs: input.legs,
    value: comboValue,
  };
}

// Rótulo de placar exato pra a perna (pura, sem provider). "Placar exato: 2 a 0".
export function exactScoreLabel(home: number, away: number): string {
  return `Placar exato: ${home} a ${away}`;
}

// Rótulo humano PT-BR de QUALQUER perna (pura — usa "mandante"/"visitante", sem nome
// de time). Fase 2: todos os kinds.
const sideLabel = (s: string) => (s === "home" ? "Mandante" : "Visitante");
const overUnder = (s: string) => (s === "over" ? "Mais" : "Menos");

export function betLegLabel(
  kind: string,
  params: Record<string, unknown>,
): string {
  switch (kind) {
    case "exact_score":
      return exactScoreLabel(Number(params.home), Number(params.away));
    case "first_half_score":
      return `Placar do 1º tempo: ${params.home} a ${params.away}`;
    case "margin":
      return `${sideLabel(String(params.side))} vence por ${params.minMargin}+ gol(s)`;
    case "clean_sheet":
      return `${sideLabel(String(params.side))} não sofre gol`;
    case "first_to_score":
      return params.firstToScore === "none"
        ? "Nenhum time marca"
        : `${sideLabel(String(params.firstToScore))} marca primeiro`;
    case "over_under":
      return `${overUnder(String(params.selection))} de ${params.line} gols`;
    case "first_half_over_under":
      return `1º tempo: ${overUnder(String(params.selection))} de ${params.line} gols`;
    case "match_result":
      return params.selection === "home"
        ? "Vitória do mandante"
        : params.selection === "away"
          ? "Vitória do visitante"
          : "Empate";
    case "btts":
      return params.selection === "yes"
        ? "Ambos os times marcam"
        : "Não saem gols dos dois lados";
    case "double_chance":
      return params.selection === "home_draw"
        ? "Mandante ou empate"
        : params.selection === "home_away"
          ? "Mandante ou visitante"
          : "Empate ou visitante";
    case "cards":
      return `${overUnder(String(params.selection))} de ${params.line} cartões`;
    case "corners":
      return `${overUnder(String(params.selection))} de ${params.line} escanteios`;
    default:
      return kind;
  }
}
