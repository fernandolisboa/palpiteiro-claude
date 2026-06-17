import { MIN_EDGE_PP } from "@/lib/odds/scenario";

import { CORRECT_SCORE_KEYS } from "./schemas";

// SYSTEM_PROMPT do cartucho de placar exato (correct_score). Reaproveita as
// regras transversais do match_result (edge ≥ MIN_EDGE_PP pp sobre a implícita
// NORMALIZADA, pass como default seguro de 1ª classe, redação leiga do rationale,
// confiabilidade de dados → reduzir confiança/pass), adaptadas pra 16 células:
// o modelo emite a DISTRIBUIÇÃO completa (16 probabilidades sobre o grid 0..3 ×
// 0..3) E escolhe UMA célula entre as 16 ou "pass". O grid é LIMITADO (placares
// fora de 0..3 não existem aqui) — a coerência da distribuição com a implícita
// vem de AMBAS normalizarem sobre as MESMAS 16 células (a restrição mais
// importante; declarada explicitamente abaixo). Placar exato é um dos mercados
// MAIS DIFÍCEIS de prever — moldura de cuidado-de-calibração reforçada.
//
// O literal `${MIN_EDGE_PP} pontos percentuais` é PINADO por teste (sincronia
// UI↔prompt; mesmo padrão do match_result/over_under).

// Lista legível das 16 chaves pro corpo do prompt (cs_0_0 → "0-0").
const GRID_LABELS = CORRECT_SCORE_KEYS.map((k) => {
  const m = k.match(/^cs_(\d+)_(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : k;
}).join(", ");

export const SYSTEM_PROMPT = `Você é um analista quantitativo de apostas esportivas focado exclusivamente no mercado de placar exato (correct score) no tempo regulamentar (90'), restrito ao grid de 16 placares possíveis com 0 a 3 gols por time: ${GRID_LABELS}.

Sua tarefa tem DUAS partes para o jogo descrito pelo usuário:
1. Estime a DISTRIBUIÇÃO completa de probabilidades sobre as 16 células do grid (cs_0_0 = placar 0-0, cs_2_1 = placar 2-1, … cs_3_3 = placar 3-3). São 16 números de 0 a 100. IMPORTANTE: o grid é LIMITADO — você condiciona a distribuição a um placar dentro de 0..3 por time e a NORMALIZA sobre essas 16 células (elas devem somar ~100 ENTRE SI, ignorando placares fora do grid). Essa normalização sobre as MESMAS 16 células é o que torna sua probabilidade comparável à implícita do bookmaker (que também é normalizada sobre as mesmas 16). É a restrição mais importante desta análise: pense "dado que o placar fica em 0..3 por time, qual a chance relativa de cada célula".
2. Escolha UMA recomendação entre 17 opções: uma das 16 células (ex.: "cs_2_1") ou "pass" (não recomendar aposta).

Regras invioláveis:
1. Recomende uma célula SOMENTE se sua probabilidade estimada para AQUELA célula (cell_probs daquela célula) supera a probabilidade implícita normalizada da MESMA célula em pelo menos ${MIN_EDGE_PP} pontos percentuais (edge >= ${MIN_EDGE_PP}%). Cada célula tem seu próprio edge (sua prob − sua implícita normalizada); compare célula a célula. Se nenhuma célula atinge o edge mínimo, retorne "pass".
2. "pass" é a opção segura por padrão e um resultado válido e esperado. Em caso de dúvida, passe a vez. Não force uma recomendação.
3. confidence_pct é sua probabilidade estimada para a CÉLULA RECOMENDADA (= a prob daquela célula). Quando "pass", reporte sua melhor estimativa para a célula mais provável.
4. minimum_odd: odd decimal mínima na qual o palpite ainda mantém edge >= ${MIN_EDGE_PP}%. Obrigatório quando recommendation é uma célula; OMITIR quando "pass".
5. Use APENAS os dados fornecidos pelo usuário. Não invente jogadores, lesões, escalações, estatísticas ou tendências.
6. Raciocine quantitativamente quando possível: forma recente (gols pró/contra), saldo de gols, mando de campo, impacto de ausências, padrão de placares no H2H, contexto e posição na competição.
7. Calibração (placar exato é MUITO DIFÍCIL): o desfecho exato é de baixa probabilidade — mesmo o placar mais provável de um jogo de futebol raramente passa de ~13-15%. A maioria das 16 células fica abaixo de 10%. Resista FORTEMENTE à tentação de concentrar probabilidade numa célula; mantenha a distribuição espalhada e realista. Overconfidence aqui é o erro mais comum — na dúvida, "pass".
8. Considere a confiabilidade dos dados: poucos jogos de forma recente, ausência de escalação publicada, ou H2H muito antigo são motivos pra reduzir confiança (e provavelmente "pass").
9. Quando a seção "Lesões / Suspensões" indicar "dados indisponíveis nesta análise" para um time, NÃO assuma que não há lesões — trate como dado faltante e reduza a confiança da análise.
10. Responda EXCLUSIVAMENTE chamando a ferramenta \`submit_prediction\` com os campos definidos no schema dela. Não produza texto livre fora da chamada da ferramenta.

Redação do campo rationale (tom, não conteúdo):
- Estas regras mudam APENAS a forma de escrever o rationale. A decisão (recommendation, probabilidades, confidence_pct, minimum_odd) segue exclusivamente as regras invioláveis acima — decida primeiro como sempre; na dúvida sobre o edge mínimo, continue passando a vez.
- Escreva para um leitor leigo, que NÃO conhece estatística de apostas: frases curtas, linguagem do dia a dia.
- Abra com a conclusão em UMA frase simples (ex.: "O placar mais provável deste jogo é 1-1." / "Melhor não apostar em placar exato neste jogo.").
- Depois da conclusão, sustente com os números decisivos (forma recente, gols por jogo, mando, ausências, placares do histórico) — a base quantitativa continua obrigatória; muda só o tom.
- Jargão técnico apenas se explicado em meia frase no próprio texto (ex.: "probabilidade implícita — a chance que a odd embute"). Prefira "histórico de confrontos" a "H2H".
- Não exagere a convicção pra soar didático: placar exato é incerto por natureza; a frase de abertura deve refletir essa incerteza real.
- Mantenha o tamanho de sempre: ~450 caracteres (máx. 600). Linguagem acessível não significa texto mais longo.`;

// Propriedades do cell_probs no tool input_schema: as 16 chaves explícitas, cada
// uma number 0..100 e required. Mantém o JSON schema da tool em ACORDO com o Zod
// (record refinado a conter exatamente as 16 chaves).
const CELL_PROBS_PROPERTIES = Object.fromEntries(
  CORRECT_SCORE_KEYS.map((k) => {
    const m = k.match(/^cs_(\d+)_(\d+)$/);
    const label = m ? `${m[1]}-${m[2]}` : k;
    return [
      k,
      {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: `Probabilidade estimada (0-100) do placar ${label}. Parte da distribuição completa sobre as 16 células.`,
      },
    ];
  }),
) as Record<
  string,
  { type: "number"; minimum: number; maximum: number; description: string }
>;

export const SUBMIT_PREDICTION_TOOL = {
  name: "submit_prediction",
  description:
    "Envia a recomendação final para o mercado de placar exato (correct score). Chame esta ferramenta EXATAMENTE UMA VEZ.",
  input_schema: {
    type: "object",
    properties: {
      recommendation: {
        type: "string",
        enum: [...CORRECT_SCORE_KEYS, "pass"],
        description:
          "Célula recomendada (ex.: 'cs_2_1' = placar 2-1), ou 'pass' se nenhuma célula tem edge >= 5%.",
      },
      confidence_pct: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description:
          "Probabilidade estimada (0-100) da célula recomendada; quando 'pass', estimativa da célula mais provável.",
      },
      cell_probs: {
        type: "object",
        properties: CELL_PROBS_PROPERTIES,
        required: [...CORRECT_SCORE_KEYS],
        additionalProperties: false,
        description:
          "Distribuição completa: probabilidade (0-100) de cada uma das 16 células, normalizada sobre o grid limitado (somam ~100 entre si).",
      },
      rationale: {
        type: "string",
        minLength: 1,
        maxLength: 600,
        description:
          "Racional conciso em português, idealmente ~450 chars (máx. 600), em linguagem acessível a leigos: abra com a conclusão em uma frase simples e depois sustente com os números decisivos. Jargão só se explicado em meia frase. Os fatores detalhados vão em key_factors.",
      },
      key_factors: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 160 },
        minItems: 2,
        maxItems: 5,
        description: "2 a 5 fatores curtos (até 160 chars cada).",
      },
      minimum_odd: {
        type: "number",
        exclusiveMinimum: 0,
        description:
          "Odd decimal mínima que mantém edge >= 5%. Obrigatório se recommendation != 'pass'; OMITIR se 'pass'.",
      },
    },
    required: [
      "recommendation",
      "confidence_pct",
      "cell_probs",
      "rationale",
      "key_factors",
    ],
    additionalProperties: false,
  },
} as const;
