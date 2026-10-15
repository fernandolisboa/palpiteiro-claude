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
      body: 'O menu fica sempre aqui em cima: jogos, suas apostas, bolão e desempenho. Em "ajuda" ficam o guia "como usar", que explica cada tela com calma, e o atalho pra rever este tour. Perfil e sair ficam no seu avatar, à direita.',
    },
    {
      target: "league-picker",
      title: "Campeonato",
      body: 'Filtre a lista por campeonato. "Todas as ligas" junta todos os campeonatos que o app acompanha.',
    },
    {
      target: "date-range",
      title: "Período",
      body: "Escolha a janela: 5 dias, 14 dias, a competição inteira ou um intervalo de datas seu.",
    },
    {
      target: "recent-predictions",
      title: "Suas predições recentes",
      body: 'Os últimos jogos que você analisou aparecem aqui. "ver todas" leva pro desempenho, com o histórico completo e o resultado de cada análise.',
    },
    {
      target: "match-row",
      title: "Abra um jogo",
      body: 'Cada linha é um jogo, com horário, odds (quando já publicadas) e "analisado" se você já rodou a análise. Toque neste pra abrir: o tour continua lá, mostrando como gerar o palpite.',
      interactive: true,
    },
  ],
  jogo: [
    {
      target: "palpite",
      title: "Palpite da IA",
      body: 'Aqui fica o palpite da IA: quem leva, o placar provável e o porquê. Toque em "Analisar com IA" pra gerar. Pode levar alguns minutos, e cada mercado analisado usa uma das suas análises do dia. Depois, "Ler análise completa" abre o porquê inteiro e o detalhe de cada mercado (odd, vantagem, stake ou sem aposta). Quer contar algo que você sabe (quem está fora, como os times vêm)? Quando aparecer, abra "Contexto extra (opcional)": a gente confere com os nossos dados antes de usar, e não conta a mais no limite.',
    },
    {
      target: "mercados",
      title: "Mercados",
      body: 'Aqui ficam a odd de mercado, a chance do modelo e a odd justa de cada seleção; a marca IA mostra o que a análise recomenda. Os "?" explicam os números num toque. Fez uma aposta com os amigos? Toque no que você apostou (ou digite a aposta): entra em Suas apostas (ao lado no computador, na barra de baixo no celular). Confira a odd que pegou e toque em "Registrar apostas". A avaliação sai na hora, sem gastar análise.',
    },
    {
      target: "seu-palpite",
      title: "Seu palpite",
      body: 'Tem um palpite seu? Escolha o placar ou o resultado e veja na hora a chance que o modelo dá, de graça. Se quiser, escreva o motivo e toque em "Analisar meu palpite": a IA lê, a gente confere com os nossos dados e o modelo recalcula (conta 1 do seu limite diário de palpites). "Adicionar às suas apostas" leva o palpite pra lista.',
    },
    {
      target: "match-stats",
      title: "Números do jogo",
      body: "Partidas recentes, confronto direto, classificação, desfalques e escalações: o mesmo contexto que a IA usa. O nome de um time, no topo do jogo ou na classificação, abre o histórico dele.",
    },
    {
      title: "Pronto",
      body: 'Depois do jogo o resultado é apurado sozinho: as análises aparecem em desempenho e as apostas que você registrou, em suas apostas. Em "ajuda", no menu do topo, o guia "como usar" explica cada tela e dá pra rever este tour.',
    },
  ],
};

/** Capítulo que abre sozinho nesta página, dado o progresso salvo. */
export function shouldAutoStart(
  chapter: TourChapter,
  state: TourState | null
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
  local: TourState | null
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
  matches: readonly { analyzable?: boolean }[]
): number {
  return matches.findIndex((m) => m.analyzable === true);
}
