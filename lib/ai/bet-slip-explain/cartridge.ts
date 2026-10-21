import { toToolDef } from "@/lib/ai/markets/types";
import type { ToolDef } from "@/lib/ai/providers/types";
import { MATCH_STAKE_CAP_UNITS } from "@/lib/bets/evaluate-slip";
import type {
  BetExplainInput,
  ExplainCombo,
  ExplainLeg,
  ExplainLegSource,
} from "@/lib/bets/explain-input";
import {
  formatEdgePoints,
  formatEvPct,
  formatOdd,
  formatPct,
  formatUnitsCompact,
} from "@/lib/format-number";
import type { ValueReadingKind } from "@/lib/view/bet-slip";

// Cartucho do "Explicar com IA" nas apostas registradas (#562, ADR 0063). O código já
// avaliou tudo no registro (chance, odd justa, retorno esperado, edge contra o mercado
// sem a margem, stake das bandas) e o veredito de cada perna é do código; o LLM só
// explica o porquê, em PT-BR, citando os números do bloco "Avaliação". Esta É a
// superfície de valor (ADR 0034 §9): odd, edge e stake podem aparecer; mandar apostar,
// prometer resultado e citar casa de apostas não. Mudou prompt ou tool → bump + commit
// `prompt:`.

export const BET_SLIP_EXPLAIN_VERSION = "bet_slip_explain_v1";
export const EXPLAIN_TOOL_NAME = "submit_bet_explanation";

export const MAX_EXPLAIN_LEGS = 8;
export const EXPLAIN_SUMMARY_MAX = 400;
export const EXPLAIN_TEXT_MAX = 320;

const SUBMIT_BET_EXPLANATION_TOOL = {
  name: EXPLAIN_TOOL_NAME,
  description:
    "Devolve a explicação das apostas registradas em português do Brasil.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      resumo: { type: "string", maxLength: EXPLAIN_SUMMARY_MAX },
      pernas: {
        type: "array",
        maxItems: MAX_EXPLAIN_LEGS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            indice: {
              type: "integer",
              minimum: 0,
              maximum: MAX_EXPLAIN_LEGS - 1,
            },
            texto: { type: "string", maxLength: EXPLAIN_TEXT_MAX },
          },
          required: ["indice", "texto"],
        },
      },
      combinada: { type: ["string", "null"], maxLength: EXPLAIN_TEXT_MAX },
    },
    required: ["resumo", "pernas", "combinada"],
  },
} as const;

export const explainTool: ToolDef = toToolDef(SUBMIT_BET_EXPLANATION_TOOL);

export const EXPLAIN_SYSTEM_PROMPT = `Você é o analista do Palpiteiro. Um usuário registrou apostas num jogo de futebol, para jogar entre amigos, e o código JÁ avaliou cada uma com um modelo estatístico de placar. Seu trabalho: explicar, em português do Brasil, o porquê dos números de cada aposta, sem mudar nenhum deles.

REGRAS INVIOLÁVEIS:
1. Números são fixos. Cite só números que aparecem no bloco "Avaliação", exatamente como estão (percentuais, odds, pontos, unidades). Não calcule nem arredonde de outro jeito.
2. O veredito de cada aposta é do código (com valor, no limite, sem valor, sem odd). Explique o porquê dele; nunca o contradiga.
3. Explique o porquê: a chance do modelo comparada com a chance mínima que a odd do usuário precisa pra se pagar; o que o mercado diz sem a margem e a vantagem do modelo em pontos (quando houver); de onde vem a chance (modelo de placar ou a análise do usuário); o que os ajustes do JEV mudaram (quando houver); e a regra do stake sugerido.
4. A chance mínima pra odd se pagar NÃO é a probabilidade do mercado. A probabilidade do mercado é só a do "mercado sem a margem".
5. Não invente fatos. Nada de lesões, resultados, tabela, notícias ou nomes que não estejam nos blocos abaixo.
6. Nunca cite casa de apostas, site ou link. Diga "odd de mercado" ou "mercado sem a margem".
7. Nunca mande apostar, aumentar, diminuir ou trocar a aposta, e não recomende nada: explique. Sem promessas de resultado ou de lucro.
8. Edge e retorno esperado são a opinião do modelo: no nosso backtest, o modelo sozinho não bateu as odds de fechamento. Deixe isso claro no resumo, sem alarde.
9. Em combinada, a chance conjunta sai do modelo de placar com as seleções juntas (elas se influenciam); não é a multiplicação das chances de cada uma.
10. Tom sóbrio, sem exclamações.

FORMATO (ferramenta ${EXPLAIN_TOOL_NAME}):
- resumo: até ${EXPLAIN_SUMMARY_MAX} caracteres, uma visão geral do registro;
- pernas: uma por aposta do bloco "Avaliação", {indice, texto}, com o índice entre colchetes; texto de até ${EXPLAIN_TEXT_MAX} caracteres;
- combinada: texto de até ${EXPLAIN_TEXT_MAX} caracteres sobre a combinada quando houver o bloco "Combinada"; senão null.
Não inclua outros campos.`;

export const READING_LABEL: Record<ValueReadingKind, string> = {
  positive: "com valor",
  zero: "no limite",
  negative: "sem valor",
  noOdd: "sem odd (só a chance e a odd justa)",
};

export const SOURCE_LABEL: Record<ExplainLegSource, string> = {
  analysis: "a sua análise com IA deste mercado",
  dixon_coles: "modelo de placar Dixon-Coles",
  heuristic: "modelo de placar simplificado (tabela)",
  model: "modelo de placar",
};

const SCORELINE_LABEL: Record<"dixon_coles" | "heuristic", string> = {
  dixon_coles:
    "Dixon-Coles (gols esperados de cada time, ajustado todo dia com os jogos da liga)",
  heuristic:
    "simplificado, a partir da tabela (sem ajuste recente do Dixon-Coles)",
};

const pct = (n: number) => formatPct(n, { decimals: 1 });
const units = (n: number) => formatUnitsCompact(n);

function referenceLine(leg: ExplainLeg): string {
  const r = leg.reference;
  if (r === null)
    return "  - mercado: sem odd de referência recente e completa deste mercado";
  // Piso só faz sentido com vantagem positiva: abaixo de zero o mercado já discorda.
  const floor =
    r.belowFloor && r.edgePp > 0
      ? `, abaixo do piso de ${String(r.floorPp).replace(".", ",")} pontos do motor`
      : "";
  return `  - mercado sem a margem: ${pct(r.impliedPct)} (odd de mercado ${formatOdd(r.odd)}); vantagem do modelo: ${formatEdgePoints(r.edgePp)}${floor}`;
}

function legBlock(leg: ExplainLeg): string {
  const lines = [
    `[${leg.index}] ${leg.label}${leg.inCombo ? " (seleção da combinada)" : ""}`,
    `  - chance pelo modelo: ${pct(leg.modelProbPct)} (fonte: ${SOURCE_LABEL[leg.source]})${leg.fairOdd === null ? "" : `; odd justa ${formatOdd(leg.fairOdd)}`}`,
  ];
  if (!leg.inCombo) {
    lines.push(
      leg.userOdd === null || leg.breakEvenPct === null || leg.evPct === null
        ? "  - sua odd: não informada"
        : `  - sua odd: ${formatOdd(leg.userOdd)}; chance mínima pra ela se pagar: ${pct(leg.breakEvenPct)}; retorno esperado: ${formatEvPct(leg.evPct / 100)}`
    );
  }
  lines.push(referenceLine(leg));
  if (leg.reading !== null) {
    lines.push(`  - veredito do código: ${READING_LABEL[leg.reading]}`);
  }
  if (leg.coherenceWarning) {
    lines.push(
      "  - a odd de mercado e a sua odd contam histórias opostas; o veredito segue a sua odd"
    );
  }
  if (!leg.inCombo) {
    const suggested =
      leg.suggestedStakeUnits === null
        ? "nenhum"
        : `${units(leg.suggestedStakeUnits)} (bandas)`;
    const yours =
      leg.userStakeUnits === null ? "não informado" : units(leg.userStakeUnits);
    lines.push(`  - stake sugerido: ${suggested}; seu stake: ${yours}`);
  }
  return lines.join("\n");
}

function comboBlock(c: ExplainCombo): string {
  const odd =
    c.userOdd === null || c.breakEvenPct === null || c.evPct === null
      ? "  - odd da combinada: não informada"
      : `  - odd da combinada: ${formatOdd(c.userOdd)}; chance mínima pra ela se pagar: ${pct(c.breakEvenPct)}; retorno esperado: ${formatEvPct(c.evPct / 100)}`;
  return [
    "Combinada:",
    `  - chance conjunta pelo modelo de placar: ${pct(c.jointProbPct)}${c.fairOdd === null ? "" : `; odd justa ${formatOdd(c.fairOdd)}`}`,
    odd,
    `  - veredito do código: ${READING_LABEL[c.reading]}`,
    `  - seu stake: ${c.userStakeUnits === null ? "não informado" : units(c.userStakeUnits)}`,
  ].join("\n");
}

function jevBlock(i: BetExplainInput): string {
  const jev = i.jev;
  if (jev === null) return "";
  const body =
    jev.kind === "applied"
      ? jev.phrases.map((p) => `- ${p}`).join("\n")
      : jev.kind === "no_change"
        ? "- o JEV foi consultado e não ajustou nada (sem desfalque relevante, rodízio ou peso de jogo)"
        : jev.kind === "not_attempted"
          ? "- sem ajuste do JEV neste momento (o jogo estava fora da janela de 48h ou o ajuste estava desligado)"
          : jev.kind === "failed"
            ? "- o JEV não respondeu; o modelo ficou sem ajuste"
            : "- sem a base do jogo no registro: o modelo foi calculado na hora, sem ajuste do JEV";
  return `\nAjustes do JEV (desfalques, rodízio e peso do jogo) no modelo de placar:\n${body}\n`;
}

export function buildExplainUserMessage(i: BetExplainInput): string {
  const mode =
    i.mode === "combinada"
      ? "Combinada: as seleções valem juntas, com uma odd e um stake só."
      : "Simples: cada seleção é uma aposta separada.";
  const model =
    i.scorelineSource === null
      ? ""
      : `\nModelo de placar: ${SCORELINE_LABEL[i.scorelineSource]}.`;
  const combo = i.combo === null ? "" : `\n${comboBlock(i.combo)}`;
  const stakeRule =
    i.mode === "simples"
      ? `\nRegra do stake sugerido: bandas do motor de 1 a 3u, só com retorno esperado positivo, somando no máximo ${MATCH_STAKE_CAP_UNITS}u por jogo. O quarter-Kelly é só informativo.`
      : "";
  return `Jogo: ${i.teams.home} (mandante) × ${i.teams.away} (visitante), ${i.competition}, ${i.kickoffLabel}.
Registro: ${mode}${model}
${jevBlock(i)}
Avaliação (números fixos, calculados pelo código):
${i.legs.map(legBlock).join("\n")}${combo}${stakeRule}

Escreva a explicação chamando ${EXPLAIN_TOOL_NAME}.`;
}

/** Os números que o texto pode citar, por família (a fidelidade compara com tolerância). */
export function allowedNumbers(i: BetExplainInput): {
  percents: number[];
  points: number[];
  decimals: number[];
  units: number[];
} {
  const percents: number[] = [];
  const points: number[] = [];
  const odds: number[] = [];
  const stakes: number[] = [1, 3, MATCH_STAKE_CAP_UNITS];
  const push = (arr: number[], n: number | null) => {
    if (n !== null && Number.isFinite(n)) arr.push(Math.abs(n));
  };
  for (const l of i.legs) {
    push(percents, l.modelProbPct);
    push(percents, l.breakEvenPct);
    push(percents, l.evPct);
    push(odds, l.fairOdd);
    push(odds, l.userOdd);
    push(stakes, l.suggestedStakeUnits);
    push(stakes, l.userStakeUnits);
    if (l.reference) {
      push(percents, l.reference.impliedPct);
      push(points, l.reference.edgePp);
      push(points, l.reference.floorPp);
      push(odds, l.reference.odd);
    }
  }
  if (i.combo) {
    push(percents, i.combo.jointProbPct);
    push(percents, i.combo.breakEvenPct);
    push(percents, i.combo.evPct);
    push(odds, i.combo.fairOdd);
    push(odds, i.combo.userOdd);
    push(stakes, i.combo.userStakeUnits);
  }
  // "pontos percentuais" passa pelo regex de percentual: o edge também vale lá.
  percents.push(...points);
  return {
    percents,
    points,
    // Número decimal solto (sem %, pontos ou u): odd, linha de gols ou qualquer número
    // do bloco escrito sem a unidade.
    decimals: [...odds, ...i.lines, ...percents, ...stakes],
    units: stakes,
  };
}
