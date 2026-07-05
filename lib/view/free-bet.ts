import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
} from "@/lib/odds/scenario";
import { profitForOutcome } from "@/lib/settlement/money";
import type { FreeBetLegView } from "@/lib/view/types";

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

// Rótulo de placar exato pra a perna (pura, sem provider). "Placar exato: 2 a 0".
export function exactScoreLabel(home: number, away: number): string {
  return `Placar exato: ${home} a ${away}`;
}
