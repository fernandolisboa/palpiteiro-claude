/**
 * Tour guiado (spotlight passo a passo). Dois capítulos, um por página, porque o
 * fluxo principal atravessa uma navegação: a lista de jogos (`/jogos`) e a página
 * do jogo (`/match/[id]`). O progresso fica em `users.tour_state`:
 *
 *  - `null`        nunca viu → o capítulo "jogos" abre sozinho na primeira visita;
 *  - `"jogos"`     viu a lista → o capítulo "jogo" abre sozinho no primeiro jogo aberto;
 *  - `"done"`      concluiu os dois → nunca mais abre sozinho;
 *  - `"dismissed"` pulou em qualquer passo → nunca mais abre sozinho.
 *
 * O "rever o tour" (`/jogos?tour=1`, linkado do /como-usar) força a partida sem
 * olhar o estado; concluir a lista de novo grava "jogos", então o capítulo do jogo
 * volta junto — é o que quem pediu pra rever espera.
 */
// Sem Zod de propósito: este módulo vai pro bundle do cliente (tour, lista de jogos).
export const TOUR_STATES = ["jogos", "done", "dismissed"] as const;
export type TourState = (typeof TOUR_STATES)[number];

export function isTourState(value: unknown): value is TourState {
  return (TOUR_STATES as readonly unknown[]).includes(value);
}

export type TourChapter = "jogos" | "jogo";

/** Query param que força a partida do tour (link "rever o tour"). */
export const TOUR_FORCE_PARAM = "tour";
export const TOUR_RESTART_HREF = `/jogos?${TOUR_FORCE_PARAM}=1`;

export type TourStep = {
  /** Valor de `data-tour` do alvo. Sem alvo = passo centralizado, sem spotlight. */
  target?: string;
  title: string;
  body: string;
  /**
   * Deixa o elemento destacado clicável (o resto da tela segue bloqueado). Só no
   * passo que convida a abrir um jogo — é assim que o tour atravessa pra página
   * do jogo.
   */
  interactive?: boolean;
};

export const TOUR_CHAPTERS: Record<TourChapter, readonly TourStep[]> = {
  jogos: [
    {
      title: "Bem-vindo ao Palpiteiro",
      body: "Em menos de um minuto te mostro onde clicar pra analisar um jogo. Se preferir explorar sozinho, é só pular — o tour não volta.",
    },
    {
      target: "menu",
      title: "Menu",
      body: "Daqui você vai pra jogos, apostas, dashboard e pro guia \"como usar\", que explica cada tela com calma e deixa rever este tour. O perfil fica no menu do celular ou no seu nome, no computador.",
    },
    {
      target: "league-picker",
      title: "Campeonato",
      body: "Filtre a lista por campeonato. \"Todas as ligas\" junta todos os campeonatos que o app acompanha.",
    },
    {
      target: "date-range",
      title: "Período",
      body: "Escolha a janela: 5 dias, 14 dias, a competição inteira ou um intervalo de datas seu.",
    },
    {
      target: "recent-predictions",
      title: "Suas predições recentes",
      body: "Os últimos jogos que você analisou aparecem aqui. \"ver todas\" leva pro dashboard, com o histórico completo e o resultado de cada análise.",
    },
    {
      target: "match-row",
      title: "Abra um jogo",
      body: "Cada linha é um jogo, com horário, odds (quando já publicadas) e \"analisado\" se você já rodou a análise. Toque neste pra abrir: o tour continua lá, mostrando como gerar o palpite.",
      interactive: true,
    },
  ],
  jogo: [
    {
      target: "palpite",
      title: "O Palpite",
      body: "Aqui fica o palpite da IA: quem leva, o placar provável e o porquê. Toque em \"Analisar com IA\" pra gerar. Pode levar alguns minutos, e cada mercado analisado usa uma das suas análises do dia.",
    },
    {
      target: "analysis-tabs",
      title: "Análise e Minha aposta",
      body: "Em \"Análise\", \"ver análise por mercado\" abre o detalhe de cada mercado (odd, edge, stake ou PASS). Em \"Minha aposta\" você escreve uma aposta sua pra avaliar e, se confirmar, ela vai pra Apostas.",
    },
    {
      target: "odds",
      title: "Odds da casa",
      body: "As odds de referência das casas pra este jogo. É contra elas que a análise mede se há vantagem. Os \"?\" explicam os números num toque.",
    },
    {
      target: "match-stats",
      title: "Números do jogo",
      body: "Partidas recentes, confronto direto, classificação, desfalques e escalações: o mesmo contexto que a IA usa. O nome de um time, no topo do jogo ou na classificação, abre o histórico dele.",
    },
    {
      title: "Pronto",
      body: "Depois do jogo o resultado é apurado sozinho: as análises aparecem no dashboard e as apostas que você confirmou, em Apostas. O guia \"como usar\", no menu da lista de jogos, explica cada tela e deixa rever este tour.",
    },
  ],
};

/** Capítulo que abre sozinho nesta página, dado o progresso salvo. */
export function shouldAutoStart(
  chapter: TourChapter,
  state: TourState | null,
): boolean {
  if (chapter === "jogos") return state === null;
  return state === "jogos";
}

/** Estado a gravar quando o usuário chega ao fim de um capítulo. */
export function stateAfterChapter(chapter: TourChapter): TourState {
  return chapter === "jogos" ? "jogos" : "done";
}

// Ordem de progresso: um valor salvo no aparelho só "vence" o do servidor se estiver
// mais adiante (cobre a gravação que ainda não chegou ao DB quando a próxima página
// renderiza). Pular e concluir empatam no fim.
const RANK: Record<TourState, number> = { jogos: 1, done: 2, dismissed: 2 };

/**
 * Junta o estado do servidor com o último salvo neste aparelho. O servidor é a
 * fonte da verdade entre aparelhos; o local só adianta, nunca atrasa.
 */
export function mergeTourState(
  server: TourState | null,
  local: TourState | null,
): TourState | null {
  if (local === null) return server;
  if (server === null) return local;
  return RANK[local] > RANK[server] ? local : server;
}

/** Parse tolerante (DB/localStorage): qualquer valor fora do enum vira null. */
export function parseTourState(raw: unknown): TourState | null {
  return isTourState(raw) ? raw : null;
}

/**
 * Linha da lista que o passo "abra um jogo" destaca: o primeiro jogo ainda
 * analisável (mesma regra da página do jogo). Jogo já começado abriria a página sem
 * o botão de análise, e o tour de lá não faria sentido. -1 = nenhum (o passo é
 * pulado).
 */
export function tourMatchIndex(
  matches: readonly { analyzable?: boolean }[],
): number {
  return matches.findIndex((m) => m.analyzable === true);
}
