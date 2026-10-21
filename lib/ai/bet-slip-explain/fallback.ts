import type {
  BetExplainInput,
  ExplainCombo,
  ExplainLeg,
} from "@/lib/bets/explain-input";
import {
  formatEdgePoints,
  formatEvPct,
  formatOdd,
  formatPct,
  formatUnitsCompact,
} from "@/lib/format-number";

import { SOURCE_LABEL } from "./cartridge";
import type { BetExplanation } from "./schema";

// Explicação TEMPLATADA (#562): usada quando o LLM falha, não cabe no prazo ou reprova
// nas guardas. Só texto do código com os números da avaliação; passa nas próprias
// guardas (teste).

const pct = (n: number) => formatPct(n, { decimals: 1 });

function oddPart(
  prob: number,
  odd: number | null,
  breakEven: number | null,
  ev: number | null
) {
  if (odd === null || breakEven === null || ev === null) {
    return `Sem a sua odd, fica a chance de ${pct(prob)} pelo modelo.`;
  }
  return `O modelo dá ${pct(prob)}; a sua odd ${formatOdd(odd)} precisa de ${pct(breakEven)} pra se pagar, então o retorno esperado é de ${formatEvPct(ev / 100)}.`;
}

function legText(l: ExplainLeg): string {
  const parts = [
    l.inCombo
      ? `O modelo dá ${pct(l.modelProbPct)} a esta seleção sozinha.`
      : oddPart(l.modelProbPct, l.userOdd, l.breakEvenPct, l.evPct),
    l.source === "analysis"
      ? "A chance vem da sua análise com IA deste mercado."
      : `A chance vem do ${SOURCE_LABEL[l.source]}.`,
  ];
  const r = l.reference;
  if (r) {
    parts.push(
      `Sem a margem, o mercado dá ${pct(r.impliedPct)} (odd de mercado ${formatOdd(r.odd)}): ${formatEdgePoints(r.edgePp)} pro modelo${r.belowFloor && r.edgePp > 0 ? ", abaixo do piso do motor" : ""}.`
    );
  }
  if (l.coherenceWarning) {
    parts.push(
      "A odd de mercado conta outra história; o veredito segue a sua odd."
    );
  }
  if (!l.inCombo && l.suggestedStakeUnits !== null) {
    parts.push(
      `Stake sugerido pelas bandas: ${formatUnitsCompact(l.suggestedStakeUnits)}.`
    );
  }
  return parts.join(" ");
}

function comboText(c: ExplainCombo): string {
  return [
    `A chance conjunta, ${pct(c.jointProbPct)}, sai do modelo de placar com as seleções juntas, não da multiplicação de cada uma.`,
    c.userOdd === null || c.breakEvenPct === null || c.evPct === null
      ? "Sem a odd da combinada, não há retorno esperado."
      : `A odd ${formatOdd(c.userOdd)} precisa de ${pct(c.breakEvenPct)} pra se pagar: retorno esperado de ${formatEvPct(c.evPct / 100)}.`,
  ].join(" ");
}

function summary(i: BetExplainInput): string {
  const jev =
    i.jev?.kind === "applied"
      ? " O modelo de placar foi ajustado pelo JEV (desfalques, rodízio ou peso do jogo)."
      : "";
  return `Os números comparam a chance do modelo com o que a sua odd precisa pra se pagar e com o mercado sem a margem.${jev} No nosso backtest, o modelo sozinho não bateu as odds de fechamento: é a opinião do modelo, não vantagem garantida.`;
}

export function templatedBetExplanation(i: BetExplainInput): BetExplanation {
  return {
    resumo: summary(i),
    pernas: i.legs.map((l) => ({ indice: l.index, texto: legText(l) })),
    combinada: i.combo === null ? null : comboText(i.combo),
  };
}
