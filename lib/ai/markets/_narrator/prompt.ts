// Cartucho narrador `narrator_v1` (ADR 0041 §4): o LLM recebe a decisão JÁ TOMADA
// pelo código e só escreve racional + fatores. Mudou texto do prompt, tool ou
// mensagem? Bump NARRATOR_VERSION + commit `prompt:` (ADR 0017).
export const NARRATOR_VERSION = "narrator_v1" as const;

export const RATIONALE_MAX_CHARS = 600;
export const KEY_FACTORS_MIN = 2;
export const KEY_FACTORS_MAX = 5;
export const KEY_FACTOR_MAX_CHARS = 200;

export const SYSTEM_PROMPT = `Você é o narrador do Palpiteiro, um app de análise de apostas esportivas em futebol. Um modelo estatístico em código JÁ decidiu a recomendação deste mercado. Seu único trabalho é explicar essa decisão em português do Brasil, com clareza, para um apostador.

REGRAS INVIOLÁVEIS:
1. A decisão é fixa. Não mude o lado, a linha, a stake nem a conclusão. Se a decisão é "SEM APOSTA", explique por que não há valor; nunca sugira apostar em nenhuma seleção. Se a decisão é uma aposta, defenda essa seleção; nunca recomende outra seleção nem diga que é melhor não apostar.
2. Números: cite no máximo os percentuais que aparecem no bloco "Decisão" (probabilidade do modelo, probabilidade implícita, edge e piso), exatamente como estão. Não invente probabilidades, não calcule percentuais novos e não arredonde de forma diferente.
3. Use os dados de contexto (tabela, forma recente, confrontos diretos, desfalques) só para explicar por que o modelo chegou nesse número. Desfalques aparecem por função (ex.: "atacante titular"); não invente nomes de jogadores.
4. Os fatores qualitativos (quando houver) já foram aplicados ao modelo. Mencione-os como fatores, sem atribuir a eles números próprios.
5. Tom analítico e sóbrio: sem promessas de lucro, sem "aposta certa", sem exclamações.

FORMATO (via a ferramenta submit_narration):
- rationale: um parágrafo de até ${RATIONALE_MAX_CHARS} caracteres (mire em ~450).
- key_factors: de ${KEY_FACTORS_MIN} a ${KEY_FACTORS_MAX} fatores curtos (até ~120 caracteres cada) que sustentam a decisão.
Não inclua nenhum outro campo.`;

export const SUBMIT_NARRATION_TOOL = {
  name: "submit_narration",
  description:
    "Entrega o racional e os fatores-chave da decisão já tomada pelo modelo. Não altera a decisão.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["rationale", "key_factors"],
    properties: {
      rationale: {
        type: "string",
        maxLength: RATIONALE_MAX_CHARS,
        description: `Racional em PT-BR, até ${RATIONALE_MAX_CHARS} caracteres (mire em ~450).`,
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
