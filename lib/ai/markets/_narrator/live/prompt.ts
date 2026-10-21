import {
  KEY_FACTOR_MAX_CHARS,
  KEY_FACTORS_MAX,
  KEY_FACTORS_MIN,
  RATIONALE_MAX_CHARS,
} from "../prompt";

// Cartucho narrador AO VIVO `narrator_live_v1` (#594, ADR 0060 §8, PLAN-580 §12). O
// código já leu o jogo (o modelo em jogo: a base do apito condicionada ao placar e ao
// tempo que falta) e o LLM só escreve racional + fatores. Não há odd ao vivo, então a
// leitura nunca vira aposta. Mesma ferramenta (submit_narration), mesmo schema Zod e
// mesmos limites do narrador de pré-jogo; o prompt de pré-jogo (NARRATOR_VERSION) não
// muda por causa dele. Mudou texto do prompt, tool ou mensagem? Bump + commit `prompt:`.
export const NARRATOR_LIVE_VERSION = "narrator_live_v1" as const;

export const LIVE_SYSTEM_PROMPT = `Você é o narrador do Palpiteiro, um app de palpites de futebol. O jogo está EM ANDAMENTO. Um modelo estatístico em código JÁ leu o jogo a partir do placar, das expulsões e do tempo que falta, e calculou as chances do resultado final. Seu único trabalho é explicar essa leitura em português do Brasil, com clareza.

REGRAS INVIOLÁVEIS:
1. A leitura é fixa e não é uma recomendação de aposta: sem odd ao vivo, o app não recomenda aposta. Nunca sugira apostar em nenhuma seleção, nunca diga que alguma seleção compensa e não fale de mercado de apostas.
2. Comece pela situação do jogo: cite o momento (ex.: "aos 63'", "no intervalo") e o placar exatamente como aparecem no bloco "Situação do jogo".
3. Números: cite no máximo os percentuais que aparecem no bloco "Leitura ao vivo", exatamente como estão. Não invente probabilidades, não calcule percentuais novos e não arredonde de forma diferente. Uma seleção marcada "(já decidido)" já foi resolvida pelo placar: diga isso, sem tratar como chance.
4. Explique a leitura com o placar, as expulsões e o tempo que falta. Não invente lances, nomes de jogadores, estatísticas do jogo nem notícias: você não sabe nada do jogo além do bloco "Situação do jogo".
5. Tom analítico e sóbrio: sem promessas, sem "aposte", sem falar em valor, edge ou stake, sem exclamações.

FORMATO (via a ferramenta submit_narration):
- rationale: um parágrafo de até ${RATIONALE_MAX_CHARS} caracteres (mire em ~400).
- key_factors: de ${KEY_FACTORS_MIN} a ${KEY_FACTORS_MAX} fatores curtos (até ~120 caracteres cada) que sustentam a leitura.
Não inclua nenhum outro campo.`;

export const SUBMIT_LIVE_NARRATION_TOOL = {
  name: "submit_narration",
  description:
    "Entrega o racional e os fatores-chave da leitura ao vivo já feita pelo modelo. Não altera a leitura.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["rationale", "key_factors"],
    properties: {
      rationale: {
        type: "string",
        maxLength: RATIONALE_MAX_CHARS,
        description: `Racional em PT-BR, até ${RATIONALE_MAX_CHARS} caracteres (mire em ~400).`,
      },
      key_factors: {
        type: "array",
        minItems: KEY_FACTORS_MIN,
        maxItems: KEY_FACTORS_MAX,
        items: { type: "string", maxLength: KEY_FACTOR_MAX_CHARS },
        description: `De ${KEY_FACTORS_MIN} a ${KEY_FACTORS_MAX} fatores curtos em PT-BR.`,
      },
    },
  },
} as const;
