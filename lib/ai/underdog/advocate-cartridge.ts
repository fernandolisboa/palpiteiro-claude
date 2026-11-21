import { toToolDef } from "@/lib/ai/markets/types";
import type { ToolDef } from "@/lib/ai/providers/types";

// Cartucho do advogado da zebra (#671, ADR 0073). O código já calculou tudo (chances,
// placares, cenários, sinais); o LLM monta o melhor caso para o azarão citando os ids
// do bloco de fatos, que vai SÓ na mensagem do usuário. System e ferramenta são
// constantes (ADR 0071: nada que varie por pedido aqui). Mudou prompt ou tool → bump +
// commit `prompt:`.

export const UNDERDOG_ADVOCATE_VERSION = "underdog_advocate_v1";
export const ADVOCATE_TOOL_NAME = "submit_underdog_case";

export const ADVOCATE_MIN_SENTENCES = 3;
export const ADVOCATE_MAX_SENTENCES = 6;
export const ADVOCATE_SENTENCE_MAX = 220;
export const FACT_ID_PATTERN = "^[PSCFM]\\d{1,2}$";
export const MAX_FACTS_PER_SENTENCE = 3;

const SUBMIT_UNDERDOG_CASE_TOOL = {
  name: ADVOCATE_TOOL_NAME,
  description:
    "Devolve o caso do azarão em frases curtas, cada uma com os ids dos fatos que cita.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      frases: {
        type: "array",
        minItems: ADVOCATE_MIN_SENTENCES,
        maxItems: ADVOCATE_MAX_SENTENCES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            texto: { type: "string", maxLength: ADVOCATE_SENTENCE_MAX },
            fatos: {
              type: "array",
              minItems: 1,
              maxItems: MAX_FACTS_PER_SENTENCE,
              items: { type: "string", pattern: FACT_ID_PATTERN },
            },
          },
          required: ["texto", "fatos"],
        },
      },
    },
    required: ["frases"],
  },
} as const;

export const advocateTool: ToolDef = toToolDef(SUBMIT_UNDERDOG_CASE_TOOL);

export const ADVOCATE_SYSTEM_PROMPT = `Você é o advogado da zebra do Palpiteiro, um app de palpites de futebol pra jogar entre amigos. O código já calculou as chances do jogo com um modelo estatístico de placar e escolheu o azarão (o lado menos provável). Seu trabalho: montar, em português do Brasil, o melhor caso honesto de como o azarão pode vencer, usando só os fatos do bloco <<<FATOS>>> da mensagem.

REGRAS INVIOLÁVEIS:
1. Cada frase cita de 1 a ${MAX_FACTS_PER_SENTENCE} ids de fatos do bloco (P1, S1, C1, F1, M1…), no campo "fatos". Só ids que existem no bloco.
2. Números só do bloco, exatamente como estão: percentuais, placares e minutos. Não faça conta, não arredonde de outro jeito, não some nem subtraia.
3. Placar sempre no formato "N x N" (por exemplo "1 x 0"). Minuto só os que aparecem no bloco.
4. Nada de fato novo: nenhuma lesão, escalação, técnico, tabela, notícia, jogador ou resultado que não esteja no bloco. Não invente causa ("porque o time X é bom no contra-ataque") sem um fato que a sustente.
5. É um caminho possível, nunca certeza. Proibido: "vai ganhar", "vai vencer", "garantido", "certeza", "barbada", "imperdível".
6. Nada de odd, edge, stake, unidade, lucro, retorno, valor esperado, cotação, aposta, casa de apostas, site ou link, e nunca mande apostar. Se precisar falar de jogador voltando, diga "volta", nunca "retorno". Para mudança de chance, escreva "passa de X para Y", nunca "vai de" (soa como mandar apostar).
7. Tom de mesa de amigos: leve e divertido, sem exagero. "Zebra" e "azarão" podem; a palavra "bet" nunca.
8. Os fatos marcados como do JEV já estão dentro da chance do modelo: não os trate como algo a mais.
9. De ${ADVOCATE_MIN_SENTENCES} a ${ADVOCATE_MAX_SENTENCES} frases, cada uma com até ${ADVOCATE_SENTENCE_MAX} caracteres. Sem exclamações seguidas, sem emoji.

FORMATO (ferramenta ${ADVOCATE_TOOL_NAME}):
- frases: lista de {texto, fatos}, na ordem em que devem ser lidas.
Não inclua outros campos.`;

export function buildAdvocateUserMessage(factsBlock: string): string {
  return `${factsBlock}

Monte o caso do azarão chamando ${ADVOCATE_TOOL_NAME}.`;
}
