// Copy das etapas do run (ADR 0064). Cada etapa tem a frase de "em andamento" e a de
// fim; o servidor manda a frase pronta. Regras: português conversacional, sem termo
// ou número de valor (o HERO passa pelo containsValueLanguage: nem a palavra "odds"),
// sem %, sem dígito de tempo e sem nome de casa de aposta.

import type { ModelFamily } from "@/lib/ai/models";

export type StepSpec = {
  id: string;
  active: string;
  done: string;
  failed: string;
  skipped?: string;
};

const FAMILY_NAME: Record<ModelFamily, string> = {
  opus: "Claude Opus",
  sonnet: "Claude Sonnet",
  haiku: "Claude Haiku",
};

export const STEPS = {
  sportsData: {
    id: "sports_data",
    active: "Lendo forma recente, confronto direto, tabela e desfalques",
    done: "Forma, confronto direto, tabela e desfalques lidos",
    failed: "Não deu pra ler todos os dados dos times",
  },
  odds: {
    id: "odds",
    active: "Lendo os preços do mercado",
    done: "Preços do mercado lidos",
    failed: "Faltaram preços do mercado em parte dos mercados",
  },
  model: {
    id: "model",
    active: "Calculando as chances do jogo com o modelo Dixon-Coles",
    done: "Chances calculadas pelo Dixon-Coles",
    failed: "O modelo estatístico não respondeu",
  },
  jev: {
    id: "jev",
    active: "Consultando o JEV, o agente que avalia o contexto do jogo",
    done: "JEV consultado: contexto do jogo avaliado",
    failed: "JEV fora do ar agora: seguimos só com o modelo",
  },
  userContext: {
    id: "user_context",
    active: "Lendo o seu contexto extra",
    done: "Seu contexto extra foi lido",
    failed: "Não deu pra ler o seu contexto extra",
  },
  savedAnalyses: {
    id: "saved_analyses",
    active: "Juntando as análises salvas deste jogo",
    done: "Análises salvas reunidas",
    failed: "Não deu pra ler as análises salvas",
  },
  liveState: {
    id: "live_state",
    active: "Lendo placar, minuto e cartões ao vivo",
    done: "Placar, minuto e cartões ao vivo lidos",
    failed: "Placar ao vivo indisponível",
  },
  liveModel: {
    id: "live_model",
    active: "Recalculando as chances com o placar e o tempo que falta",
    done: "Chances recalculadas para o momento do jogo",
    failed: "Sem modelo ao vivo para este jogo",
  },
  news: {
    id: "news",
    active: "Buscando notícias do jogo",
    done: "Notícias do jogo lidas",
    failed: "Notícias indisponíveis agora: o palpite segue sem elas",
    skipped: "Sem tempo para notícias desta vez",
  },
  check: {
    id: "check",
    active: "Conferindo o palpite com as análises",
    done: "Palpite conferido com as análises",
    failed: "O palpite não bateu com as análises",
  },
} as const satisfies Record<string, StepSpec>;

// Frases de desfecho que dependem do que aconteceu (não do id).
export const STEP_NOTES = {
  modelFallback: "Chances calculadas pelo modelo de reserva",
  modelUnavailable: "Sem dados para o modelo estatístico neste jogo",
  jevReused: "JEV já consultado neste cenário: respostas reaproveitadas",
  newsEmpty: "Nenhuma notícia relevante do jogo",
} as const;

// Mercado decidido em código e escolhido pra narração (ADR 0041 §4).
export function decideStep(marketLabel: string | null): StepSpec {
  const done = marketLabel
    ? `Mercado escolhido para a análise: ${marketLabel}`
    : "Mercado escolhido para a análise";
  return {
    id: "decide",
    active: "Comparando as chances do modelo com o mercado",
    done,
    failed: "Nenhum mercado pôde ser escolhido",
  };
}

// A narração (chamada paga) do mercado escolhido, ou a leitura ao vivo.
export function narrationStep(args: {
  family: ModelFamily;
  marketLabel: string | null;
  live: boolean;
}): StepSpec {
  const model = FAMILY_NAME[args.family];
  const what = args.live
    ? "a leitura ao vivo"
    : args.marketLabel
      ? `a análise de ${args.marketLabel}`
      : "a análise";
  return {
    id: "narration",
    active: `Escrevendo ${what} com o ${model}`,
    done: args.live
      ? "Leitura ao vivo escrita e conferida"
      : "Análise escrita e conferida com os números",
    failed: "A IA não respondeu: a análise saiu com o texto padrão",
    skipped: "Sem tempo para o texto da IA: a análise saiu com o texto padrão",
  };
}

// Um mercado analisado por inteiro pela IA (placar exato, artilheiro, assistência, ou
// qualquer mercado no motor 'llm'). Um id por mercado: correm em paralelo.
export function marketStep(
  marketKey: string,
  marketLabel: string | null,
  family: ModelFamily,
): StepSpec {
  const label = marketLabel ?? "o mercado";
  const subject = marketLabel ?? "Mercado";
  return {
    id: `market:${marketKey}`,
    active: `Analisando ${label} com o ${FAMILY_NAME[family]}`,
    done: `${subject}: análise pronta`,
    failed: `${subject}: a análise não saiu`,
  };
}

// A síntese (manchete) no fim do run.
export function synthesisStep(live: boolean): StepSpec {
  return {
    id: "synthesis",
    active: live
      ? "Falta pouco: montando o palpite ao vivo"
      : "Falta pouco: montando o palpite",
    done: "Palpite pronto",
    failed: "O palpite não saiu desta vez",
    skipped: "Sem tempo para montar o palpite",
  };
}
