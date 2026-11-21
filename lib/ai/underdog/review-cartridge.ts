import { toToolDef } from "@/lib/ai/markets/types";
import type { ToolDef } from "@/lib/ai/providers/types";

import { ADVOCATE_MAX_SENTENCES } from "./advocate-cartridge";

// Cartucho do revisor adversarial (#671, ADR 0072): Haiku em contexto LIMPO. Recebe só
// o bloco de fatos e o rascunho numerado (nada do system do advogado), dá um veredito
// por frase e escreve o contraponto. O código corta só `sem_base`. System e ferramenta
// constantes (ADR 0071). Mudou prompt ou tool → bump + commit `prompt:`.

export const UNDERDOG_REVIEW_VERSION = "underdog_review_v1";
export const REVIEW_TOOL_NAME = "submit_underdog_review";

export const REVIEW_REASON_MAX = 160;
export const COUNTERPOINT_MAX = 320;

const SUBMIT_UNDERDOG_REVIEW_TOOL = {
  name: REVIEW_TOOL_NAME,
  description:
    "Devolve o veredito de cada frase do rascunho e o contraponto, em português do Brasil.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      avaliacoes: {
        type: "array",
        minItems: 1,
        maxItems: ADVOCATE_MAX_SENTENCES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            indice: {
              type: "integer",
              minimum: 0,
              maximum: ADVOCATE_MAX_SENTENCES - 1,
            },
            veredito: {
              type: "string",
              enum: ["apoiada", "exagerada", "sem_base"],
            },
            motivo: { type: "string", maxLength: REVIEW_REASON_MAX },
          },
          required: ["indice", "veredito", "motivo"],
        },
      },
      contraponto: { type: "string", maxLength: COUNTERPOINT_MAX },
    },
    required: ["avaliacoes", "contraponto"],
  },
} as const;

export const reviewTool: ToolDef = toToolDef(SUBMIT_UNDERDOG_REVIEW_TOOL);

export const REVIEW_SYSTEM_PROMPT = `Você é o revisor adversarial do Palpiteiro, um app de palpites de futebol pra jogar entre amigos. Outro modelo escreveu um rascunho defendendo que o azarão de um jogo pode vencer. Seu trabalho: conferir cada frase do rascunho contra o bloco <<<FATOS>>> (a única fonte de verdade) e escrever o contraponto.

VEREDITO DE CADA FRASE (uma avaliação por índice do rascunho, nem a mais nem a menos):
- apoiada: todo número e toda afirmação da frase estão no bloco de fatos.
- exagerada: a base está no bloco, mas a frase aumenta a chance, trata possibilidade como provável ou como certa.
- sem_base: a frase traz número, fato, nome ou relação de causa que não está no bloco. É objetivo: se não está no bloco, é sem_base.
Entre apoiada e exagerada, na dúvida, escolha exagerada. "motivo": uma frase curta dizendo o porquê.

CONTRAPONTO:
- De 1 a 2 frases, até ${COUNTERPOINT_MAX} caracteres, lembrando por que o mais provável segue sendo o empate ou a vitória do favorito. Se houver frases exageradas, responda a elas.
- Números só do bloco, exatamente como estão; placar no formato "N x N".
- Não cite nem parafraseie frase que você marcou como sem_base.
- Nada de odd, edge, stake, unidade, lucro, retorno, valor esperado, cotação, aposta, casa de apostas, site ou link; nunca mande apostar nem escreva "vai de"; sem "garantido", "certeza" ou "barbada"; a palavra "bet" nunca.
- Tom de mesa de amigos, leve e sóbrio, sem emoji.

FORMATO (ferramenta ${REVIEW_TOOL_NAME}):
- avaliacoes: lista de {indice, veredito, motivo};
- contraponto: o texto.
Não inclua outros campos.`;

export function buildReviewUserMessage(
  factsBlock: string,
  draft: { text: string; facts: string[] }[]
): string {
  const lines = draft.map(
    (s, i) => `[${i}] ${s.text} (fatos: ${s.facts.join(", ")})`
  );
  return `${factsBlock}

Rascunho do advogado da zebra:
${lines.join("\n")}

Avalie cada frase e escreva o contraponto chamando ${REVIEW_TOOL_NAME}.`;
}
