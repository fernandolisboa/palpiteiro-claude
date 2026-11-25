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
  // Notícias (#670): cada desfecho diz o que aconteceu de verdade. "Nenhuma notícia"
  // só quando a fonte respondeu e não havia nada.
  newsNoneGe: "Nada novo sobre o jogo no ge nos últimos três dias",
  newsNoneWeb: "A busca não achou notícia recente do jogo",
  newsNoSearch: "A busca de notícias não rodou desta vez",
  newsPartial: "Só deu pra ler as notícias de um dos times",
  // Notícias guardadas (#672): o cron viu notícia nova, mas a extração não a leu. A
  // análise segue com a busca ao vivo, que vira só texto.
  newsNotChecked: "As notícias de hoje ainda não foram conferidas: entram só no texto",
  // Narração reprovada pela nossa conferência (#669), por tipo. "A IA não respondeu"
  // (sem resposta, erro, recusa) é o `failed` de narrationStep.
  narrationOffFormat: "O texto da IA veio fora do formato: a análise saiu com o texto padrão",
  narrationMismatch:
    "O texto da IA não passou na conferência com os números: a análise saiu com o texto padrão",
  narrationOffFormatLive: "O texto da IA veio fora do formato: a leitura saiu com o texto padrão",
  narrationMismatchLive:
    "O texto da IA não passou na conferência com os números: a leitura saiu com o texto padrão",
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
    failed: `A IA não respondeu: a ${args.live ? "leitura" : "análise"} saiu com o texto padrão`,
    skipped: `Sem tempo para o texto da IA: a ${args.live ? "leitura" : "análise"} saiu com o texto padrão`,
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

// Hora do lote de notícias guardado (#672, ajuste 10: a análise vê o lote do último cron
// da base, então o passo diz de quando é). "às 13h30" no mesmo dia, "ontem às 22h30" no
// anterior, no fuso de Brasília.
const NEWS_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const NEWS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function newsBatchTimeLabel(at: Date, now: Date): string {
  const [hh, mm] = NEWS_TIME.format(at).split(":");
  const time = `${hh}h${mm}`;
  if (NEWS_DAY.format(at) === NEWS_DAY.format(now)) return `às ${time}`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  return NEWS_DAY.format(at) === NEWS_DAY.format(yesterday)
    ? `ontem às ${time}`
    : `em ${NEWS_DAY.format(at).slice(8, 10)}/${NEWS_DAY.format(at).slice(5, 7)} às ${time}`;
}

/**
 * Rótulo do passo de notícias guardadas (#672, PLAN-672 §8.1): "12 notícias do ge lidas
 * às 13h30 · 1 virou fator". `factors` null = a notícia não podia virar fator neste run
 * (sem a parte do "· K"). Sem notícia na janela: a frase do ge vazio de hoje.
 */
export function newsFactorsLabel(args: {
  itemsRead: number;
  factors: number | null;
  at: Date;
  now: Date;
}): string {
  const { itemsRead: n, factors: k } = args;
  if (n === 0) return STEP_NOTES.newsNoneGe;
  const read = `${n} ${n === 1 ? "notícia do ge lida" : "notícias do ge lidas"} ${newsBatchTimeLabel(args.at, args.now)}`;
  if (k === null) return read;
  const factor =
    k === 0 ? "nenhuma virou fator" : k === 1 ? "1 virou fator" : `${k} viraram fator`;
  return `${read} · ${factor}`;
}
