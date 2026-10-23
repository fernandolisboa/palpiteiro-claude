import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { Users } from "lucide-react";
import { z } from "zod";

import { BackLink } from "@/components/back-link";
import { PageContainer } from "@/components/page-container";
import { FullAnalysis } from "@/components/full-analysis";
import { MatchAuxiliarySections } from "@/components/match-sections-auxiliary";
import { MatchHero } from "@/components/match-hero";
import { MatchSections } from "@/components/match-sections";
import { PalpiteArea } from "@/components/palpites/palpite-area";
import { readAnalysisEngine } from "@/lib/ai/engine/analysis-engine-flag";
import {
  toAnalysisUserContextView,
  type AnalysisUserContextView,
} from "@/lib/view/analysis-user-context";
import { GuidedTour } from "@/components/tour/guided-tour";
import { MatchTabs } from "@/components/match-tabs";
import {
  MatchAuxiliarySkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";
import { BetSlipProvider } from "@/components/bet-slip/bet-slip-provider";
import {
  MarketTableSection,
  MarketTableSkeleton,
} from "@/components/bet-slip/market-table-section";
import { SlipMobileRiskNotice } from "@/components/bet-slip/risk-notice";
import { SlipMobileBar } from "@/components/bet-slip/slip-mobile-bar";
import { SlipAside } from "@/components/bet-slip/slip-panel";
import {
  SeuPalpiteSection,
  SeuPalpiteSkeleton,
} from "@/components/seu-palpite-section";
import { seuPalpiteClosedMessage } from "@/app/actions/not-analyzable";
import { auth } from "@/auth";
import { leagueToKey } from "@/lib/format";
import { teamToTeam } from "@/lib/view/team";
import {
  getEnableBestBetFanOut,
  getEnableLiveMode,
  getEnableUserContext,
} from "@/lib/db/queries/ai-config";
import { getInPlayState, type InPlayState } from "@/lib/live/in-play-state";
import { poolWindowOpen } from "@/lib/pools/pool-state";
import { latestAnalysisByMarket } from "@/lib/bets/analysis-probs";
import { resolveInPlaySlipModel, resolveSlipModel } from "@/lib/bets/slip-model";
import { getReferenceOddsForMatch } from "@/lib/db/queries/reference-odds";
import { toBetGridView, type BetGridView } from "@/lib/view/bet-slip";
import { getMatchById } from "@/lib/db/queries/matches";
import { getTourState } from "@/lib/db/queries/users";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";
import { getLatestUserPalpiteAnalysis } from "@/lib/db/queries/user-palpite-analyses";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { resolvePalpiteModelBase } from "@/lib/user-palpite/model-base";
import { inPlayReadingFor } from "@/lib/user-palpite/reading";
import {
  loadSeuPalpiteData,
  type SeuPalpiteData,
} from "@/lib/view/user-palpite";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { PAGE_LIVE_MARKETS } from "@/lib/odds/live-card-markets";
import { isPreMatchForOdds } from "@/lib/odds/pre-match-gate";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import {
  palpiteBeforeLineupNotice,
  toMarketAnalysisSections,
  toPreviousAnalysisItems,
} from "@/lib/view/analysis";
import { loadMatchModelReading } from "@/lib/model-base/reading";
import { toMatchHeroView } from "@/lib/view/match";
import { heroLiveFollow } from "@/lib/view/live-score";
import {
  analysisAreaFlags,
  matchCapabilities,
  matchPhase,
  unavailableNoticeCopy,
  type MatchUnavailableReason,
} from "@/lib/view/match-availability";
import {
  toPalpiteHeadlineViewFromSet,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { resolveBackHref, teamFromBackHref } from "@/lib/view/back-href";
import { parseMatchTab, type MatchTab } from "@/lib/view/match-tabs";
import type {
  MarketAnalysisSectionItem,
  MatchHeroView,
  PreviousAnalysisItem,
} from "@/lib/view/types";
import { cn } from "@/lib/utils";

// Os fan-outs (melhor aposta #178, multi-mercado #245) rodam até MAX_FANOUT_MARKETS (7)
// predict() num request (em paralelo com a flag enable_parallel_fan_out, em série sem
// ela), e um modelo adaptive leva 45–90s por chamada. Estende o
// budget da rota (Vercel max). As actions têm prazo próprio de 270s (ACTION_BUDGET_MS,
// lib/ai/deadline.ts, #524): o que não cabe vira "Tempo esgotado — não analisado" sem
// gasto nem slot, e o timeout de cada chamada é cortado pelo que resta — o request
// responde antes deste teto.
export const maxDuration = 300;

// Render dinâmico explícito: lê o cookie de fuso (#1) por-request. auth() já a
// tornava dinâmica; o explícito blinda a correção de fuso de um passe estático.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; aba?: string | string[] }>;
};

// Uma leitura do jogo por request, compartilhada entre a metadata e a página.
const loadMatch = cache(getMatchById);

// Título da aba com os times (#441): "Flamengo × Palmeiras · Palpiteiro". Mesmo nome de
// exibição da página. A metadata não chega a bots (rota gateada), então não há o que indexar.
export async function generateMetadata({
  params,
}: Pick<PageProps, "params">): Promise<Metadata> {
  const { id } = await params;
  // Mesmo guard da página: id fora do formato uuid não vai ao banco (a página dá 404).
  const match = z.uuid().safeParse(id).success ? await loadMatch(id) : null;
  if (!match) return { title: "Jogo" };
  const leagueKey = leagueToKey(match.league);
  const home = teamToTeam(match.homeTeam, leagueKey).name;
  const away = teamToTeam(match.awayTeam, leagueKey).name;
  return { title: `${home} × ${away}` };
}

export default async function MatchPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  // "Voltar" preserva o estado de busca da origem: recompõe a URL a partir do
  // param `back` (validado anti open-redirect; fallback /jogos). Um jogo pode ser
  // aberto da lista /jogos OU do histórico de um time (/time/[team], #408) — ambas
  // as bases são aceitas; fallback = /jogos (origem default).
  const query = await searchParams;
  const backHref = resolveBackHref(query.back, ["/jogos", "/time"]);
  // Aba aberta (#576): o SSR já sai com ela visível (sem pulo); depois a troca é local.
  const initialTab = parseMatchTab(query.aba);
  // Middleware garante sessão; redirect defensivo caso o matcher mude. Sessão e jogo
  // são independentes: buscados juntos (cada um é um round trip ao banco).
  // Id fora do formato uuid nem chega ao banco (o Postgres lançaria e cairia no
  // error.tsx): é o 404 de jogo não encontrado, como no bolão.
  if (!z.uuid().safeParse(id).success) notFound();
  const [session, match] = await Promise.all([auth(), loadMatch(id)]);
  if (!session?.user?.id) redirect("/signin");
  if (!match) notFound();

  // Instante ÚNICO do request: alimenta o gate de analisabilidade (kickoff>now) E
  // o heroView (isInProgress p/ a badge "ao vivo"). Um único `now` garante que o
  // gate e a badge não discordem por milissegundos (#385).
  const now = new Date();

  // Fuso de exibição do usuário (#1) — kickoff/countdown do hero no fuso do navegador.
  const timeZone = await getRequestTimeZone();

  // Nome de EXIBIÇÃO dos times nos rótulos de 1X2/dupla chance (#574): tabela de
  // mercados, análises e "Seu palpite" (nome curto, #578).
  const leagueKey = leagueToKey(match.league);
  const displayTeams = {
    home: teamToTeam(match.homeTeam, leagueKey).name,
    away: teamToTeam(match.awayTeam, leagueKey).name,
  };
  // Rótulo do "voltar" pela origem resolvida (#446): vindo do histórico de um time, o
  // link diz o nome dele, não "jogos".
  const backTeam = teamFromBackHref(backHref, [match.homeTeam, match.awayTeam]);
  const backLabel = backTeam ? teamToTeam(backTeam, leagueKey).name : "jogos";

  // Pré-aquece over/under + 1X2 ao vivo (#173): featured/batch, +1 crédito de liga por
  // refresh stale (h2h é market separado de totals). A tabela de mercados lê as capturas
  // DEPOIS do warm (a leitura não pode correr antes da escrita).
  //
  // FORA do caminho crítico: com o snapshot vencido o refresh espera a The Odds API, e só
  // a tabela de mercados depende dele (o hero não mostra odd). A página renderiza sem
  // esperar e a tabela chega por streaming. Criada UMA vez aqui.
  // Fora do pré-jogo (já apitou, adiado, cancelado) o ensure não busca nada (gate de
  // quota, pre-match-gate.ts): nem o chamamos, a tabela lê direto o que está no banco.
  const refreshP: Promise<void> = (
    isPreMatchForOdds(match, now)
      ? ensureOddsSnapshotsFresh(match, { markets: PAGE_LIVE_MARKETS })
      : Promise.resolve(null)
  )
    .then(() => undefined)
    .catch((err: unknown) => {
      // Provider/rede já viram null dentro do ensure; aqui sobra erro de DB. Com a página
      // já na tela, deixar rejeitar trocaria tudo pelo error.tsx na hidratação: a tabela
      // segue com o que houver no banco (ou "Odds indisponíveis").
      console.error(
        JSON.stringify({
          scope: "match-page",
          error: "odds_refresh_failed",
          message: err instanceof Error ? err.message : String(err),
        })
      );
    });
  // Estado ao vivo (#580, ADR 0060): só depois do apito e de jogo que o banco ainda não
  // deu como encerrado/adiado/cancelado (antes do apito nada busca). Flag desligada:
  // nem lê o estado, a página é a de antes. `getInPlayState` respeita o cache de 1 min
  // na row (≤ 1 chamada de API-Football por minuto por jogo) e nunca toca a The Odds
  // API; falha não derruba a página (sem estado = "placar ao vivo indisponível").
  // Depois da janela de busca (kickoff + 4h) `getInPlayState` só lê a row terminal, sem
  // buscar: o fim dado pelo provider ainda aparece; sem ele, a fase volta ao "já
  // começou" (matchPhase) e o cabeçalho não acompanha mais (heroLiveFollow).
  const mayBeLive =
    (match.status === "scheduled" || match.status === "live") &&
    match.kickoffAt.getTime() <= now.getTime();
  const liveP: Promise<{ liveMode: boolean; state: InPlayState | null }> =
    mayBeLive
      ? getEnableLiveMode()
          .then(async (liveMode) => ({
            liveMode,
            state: liveMode ? await getInPlayState(match, { now }) : null,
          }))
          .catch((err: unknown) => {
            console.error(
              JSON.stringify({
                scope: "match-page",
                error: "in_play_state_failed",
                message: err instanceof Error ? err.message : String(err),
              })
            );
            return { liveMode: false, state: null };
          })
      : Promise.resolve({ liveMode: false, state: null });

  // Predição existente e demais leituras em paralelo: pré-requisito pro render
  // síncrono do hero + panel.
  const [
    history,
    palpiteSets,
    bestBetEnabled,
    tourState,
    userContextEnabled,
    analysisEngine,
    live,
  ] = await Promise.all([
    // Histórico COMPLETO: agrupado por mercado em toMarketAnalysisSections (#243, a
    // última de cada mercado = uma seção) e em toPreviousAnalysisItems (as reanálises
    // mais antigas, #204). Scoped por userId (sem leak, AC2).
    getPredictionHistoryForMatch(match.id, session.user.id),
    // Sets de palpite persistidos (#351): só `sets[0]` (o mais recente) alimenta o HERO.
    // A query traz o histórico completo (espelha o painel interim); overhead mínimo —
    // uma query "latest-only" seria follow-up se virar gargalo (PLAN §3.1 nota).
    getPalpiteSetsForMatch(match.id, session.user.id),
    getEnableBestBetFanOut(),
    getTourState(session.user.id),
    getEnableUserContext(),
    // Motor (#565): o "Contexto extra" do HERO só vale no code_jev.
    readAnalysisEngine(),
    liveP,
  ]);
  const { liveMode, state: inPlayState } = live;
  const latestPred = history[0] ?? null;

  // Manchete palpite-first (ADR 0030 / #351): o HERO server-rendered lê o set mais
  // recente. null = sem palpite ainda (estado empty/CTA) OU set antigo pré-#353 sem
  // manchete. Dado puro sem número de valor (firewall no tipo) → cruza Server→Client.
  const heroPalpite: PalpiteHeadlineView | null = palpiteSets[0]
    ? toPalpiteHeadlineViewFromSet(palpiteSets[0])
    : null;
  // #384: id + shared_at do set mais recente, pro botão de compartilhar do HERO (gera/copia
  // o link /p/[id] e ramifica Compartilhar/Copiar). null quando não há set persistido ainda.
  const heroSetId = palpiteSets[0]?.palpiteSet.id ?? null;
  const heroSharedAt = palpiteSets[0]?.palpiteSet.sharedAt ?? null;
  // #619: análise reconferida com a escalação depois do palpite exibido → uma linha no
  // HERO (só texto). Sem palpite, nada.
  const heroLineupNotice = palpiteSets[0]
    ? palpiteBeforeLineupNotice(history, palpiteSets[0].palpiteSet.createdAt)
    : null;

  // toMatchHeroView (não toMatchRowView): o tipo do hero não tem a leitura do modelo
  // (firewall ADR 0030).
  const heroView = toMatchHeroView({
    match: {
      id: match.id,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      updatedAt: match.updatedAt,
      homeTeamCrestUrl: match.homeTeamCrestUrl,
      awayTeamCrestUrl: match.awayTeamCrestUrl,
    },
    // O hero não mostra odd (a tabela de mercados chega por streaming, refreshP acima).
    odds: null,
    hasPrediction: latestPred !== null,
    now,
    timeZone,
    // Placar, minuto e expulsões do estado ao vivo quando fresco (≤ 10 min); senão o
    // parcial do sync, como antes. Nunca odd nem modelo (firewall ADR 0030).
    inPlay: inPlayState,
  });
  // Cabeçalho acompanhando o jogo: "Atualizar placar" (+ refresh ao voltar pra aba) e,
  // sem placar ao vivo utilizável, "placar ao vivo indisponível". Some quando o
  // provider já deu o fim.
  // Só dentro da janela de busca (kickoff + 4h): depois dela o botão nunca acharia
  // placar novo, e a fase volta ao "já começou" (matchPhase).
  const heroLive = heroLiveFollow({
    liveMode,
    match,
    state: inPlayState,
    liveScoreShown: heroView.liveScore?.live === true,
    now,
  });

  // Última análise por MERCADO (#243): uma seção colapsável por mercado (≥2) ou o
  // resultado cru (≤1, idêntico ao atual). ANTERIORES (#204) = as reanálises mais
  // antigas (não-latest de cada mercado). Ambas pela MESMA fiação multi-mercado
  // (#170/#173) centralizada em lib/view/analysis, market-agnostic (labels do registry).
  const sections: MarketAnalysisSectionItem[] = toMarketAnalysisSections(
    history,
    new Date(),
    timeZone,
    displayTeams
  );
  const previousAnalyses: PreviousAnalysisItem[] = toPreviousAnalysisItems(
    history,
    new Date(),
    timeZone,
    displayTeams
  );
  // "Leituras ao vivo" (#594, PLAN-580 §11): a última leitura ao vivo de cada mercado,
  // separada da análise de pré-jogo (que segue sendo a última de antes do apito).
  const liveSections: MarketAnalysisSectionItem[] = toMarketAnalysisSections(
    history,
    new Date(),
    timeZone,
    displayTeams,
    { live: true }
  );

  // "O que você acrescentou" vem da análise visível.
  const userContextView = toAnalysisUserContextView(
    history,
    { home: match.homeTeam, away: match.awayTeam },
    now
  );

  const fixtureRef: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  // Histórico do time (#408): o nome de cada time no hero linka pra /time/[team].
  // A chave É o canonical PERSISTIDO (match.homeTeam/awayTeam) — a MESMA string do
  // WHERE em getMatchesByTeam → imune a mismatch por construção. URL-encoded (#407).
  const homeTeamHref = `/time/${encodeURIComponent(match.homeTeam)}`;
  const awayTeamHref = `/time/${encodeURIComponent(match.awayTeam)}`;
  // Espelha o gate de predict()/actions: pré-jogo = `scheduled` E kickoff no
  // FUTURO (#385). O enum DB pode ficar stale `scheduled` por até ~6h depois do
  // apito (cron 0 */6) — o gate não pode confiar só no status, ou um jogo já em
  // andamento gastaria numa análise. `live`/`postponed`/encerrado também NÃO são
  // analisáveis. A CTA do HERO fica escondida nesses casos pra não submeter um
  // form que o server rejeitaria; predições/palpites já existentes seguem visíveis.
  // O motivo (ao vivo/adiado/cancelado/encerrado) escolhe a copy do HERO e do aviso.
  // Ao vivo (#580): com a flag ligada, a fase vem do estado lido acima; desligada, é o
  // gate de hoje (fecha no apito).
  const phase = matchPhase(match, inPlayState, now, { liveMode });
  const unavailableReason = phase.reason;
  // Leitura ao vivo (#594, ADR 0060 §8): com o jogo rolando e o estado bom, o modelo em
  // jogo (a base do apito condicionada ao placar e ao minuto) decide se a análise e o
  // "Seu palpite" abrem (`modelReady`). Calculado UMA vez e compartilhado com a tabela e
  // o "Seu palpite"; nunca toca a The Odds API. Antes do apito nada disso roda.
  const liveReadable =
    liveMode &&
    phase.actionable &&
    (phase.kind === "in_play" || phase.kind === "half_time") &&
    inPlayState?.score != null;
  const inPlayModelP: Promise<ModelScoreline | null> | null =
    liveReadable && inPlayState
      ? resolveInPlaySlipModel(match, inPlayState).catch((err: unknown) => {
          console.error(
            JSON.stringify({
              scope: "match-page",
              error: "in_play_model_failed",
              message: err instanceof Error ? err.message : String(err),
            })
          );
          return null;
        })
      : null;
  const inPlayModel = inPlayModelP ? await inPlayModelP : null;
  // O que a página libera agora, num lugar só (#576), por capacidade (ADR 0060). Antes
  // do apito não muda nada (o pré-jogo libera tudo). O atalho do bolão segue a janela do
  // bolão ao vivo (até os 15', `poolWindowOpen`), a mesma regra de /bolao e de
  // createFriendPool.
  const rawCaps = matchCapabilities(phase, {
    liveMode,
    modelReady: inPlayModel !== null,
    poolWindowOpen: poolWindowOpen(match, inPlayState, now, { liveMode }),
  });
  // A página está na leitura ao vivo (o HERO manda pageLive=1 e muda a copy).
  const liveAnalysis = phase.kind !== "pre" && rawCaps.analyze;
  // "Contexto extra (opcional)" no HERO (#565): kill-switch E motor code_jev (a action
  // confere de novo). Só antes do apito: ao vivo a action descarta o texto (#594).
  const contextEnabled =
    userContextEnabled && analysisEngine === "code_jev" && phase.kind === "pre";
  // "Ler análise completa" abre com qualquer análise salva (pré-jogo ou ao vivo, em
  // qualquer fase); "Gerar só o palpite" só sobre as da fase de agora.
  const { canOpenAnalysis, canRegenerate } = analysisAreaFlags(phase.kind, {
    sections: sections.length,
    liveSections: liveSections.length,
  });
  // Registro ao vivo (#580, §9.2): só com o placar do estado (a tabela precisa dele pra
  // condicionar o modelo e marcar o que já está decidido; a action recusa sem ele).
  const liveScore =
    phase.kind !== "pre" && inPlayState?.score ? inPlayState.score : null;
  const caps = {
    ...rawCaps,
    registerBets: rawCaps.registerBets && (phase.kind === "pre" || liveScore !== null),
  };
  const liveGrid =
    caps.registerBets && liveScore !== null && inPlayState
      ? { score: liveScore, minuteLabel: inPlayState.minuteLabel }
      : null;

  // Fonte e JEV da base do modelo (#555, ADR 0052), lidos do banco (sem odd, sem chamada
  // externa): o rodapé da tabela de mercados. Só em jogo analisável.
  const modelReading = caps.analyze
    ? loadMatchModelReading({ matchId: match.id, now, teams: displayTeams })
    : null;

  // Tabela de mercados (#556/#576), por streaming. Antes do apito: odd de referência,
  // chance (a da sua análise do mercado, senão o modelo do jogo, pela porta única
  // lib/bets/slip-model) e os botões de registro. Ao vivo (#580): "Odds antes do jogo"
  // (última captura até o apito), a chance do modelo em jogo calculado agora (nunca a de
  // uma análise salva) e os botões, menos nas seleções já decididas. Fora disso: só
  // leitura, com a última captura de antes do jogo (sem o corte de idade do cupom). As
  // capturas são lidas DEPOIS do refresh que a página já faz (refreshP, que só existe no
  // pré-jogo): nenhuma chamada à Odds API depois do apito.
  // Falha vira tabela sem odds/sem modelo (os botões ainda registram).
  // Rótulos de tela (#578): nome curto. Nada aqui vai ao modelo (as actions releem o
  // canonical do banco), então a tabela e o "Seu palpite" usam os mesmos displayTeams.
  const teams = displayTeams;
  const gridMode = caps.registerBets ? "register" : "readOnly";
  // O modelo ao vivo é calculado UMA vez e compartilhado pela tabela e pelo "Seu palpite"
  // (que só cai nele quando não há base fresca do jogo). Em jogo, é o modelo em jogo: a
  // base do apito condicionada ao placar e ao minuto do estado.
  let slipModelP: Promise<ModelScoreline | null> | null = null;
  const slipModel = () =>
    (slipModelP ??=
      liveGrid && inPlayState
        ? (inPlayModelP ?? resolveInPlaySlipModel(match, inPlayState))
        : resolveSlipModel(match));
  const betGridP: Promise<BetGridView> = Promise.all([
    caps.registerBets ? slipModel() : Promise.resolve(null),
    refreshP.then(() =>
      getReferenceOddsForMatch(
        match.id,
        now,
        phase.kind === "pre"
          ? {}
          : { maxAgeMs: null, capturedBefore: match.kickoffAt }
      )
    ),
    modelReading ?? Promise.resolve(null),
  ])
    .then(([model, references, reading]) =>
      toBetGridView({
        teams,
        model,
        references,
        analysis: liveGrid ? new Map() : latestAnalysisByMarket(history),
        mode: gridMode,
        modelReading: reading ? { source: reading.source, jev: reading.jev } : null,
        unavailable: unavailableReason,
        now,
        live: liveGrid,
      })
    )
    .catch((err: unknown): BetGridView => {
      console.error(
        JSON.stringify({
          scope: "match-page",
          error: "bet_grid_failed",
          message: err instanceof Error ? err.message : String(err),
        })
      );
      return toBetGridView({
        teams,
        model: null,
        references: new Map(),
        analysis: new Map(),
        mode: gridMode,
        unavailable: unavailableReason,
        now,
        live: liveGrid,
      });
    });

  // "Seu palpite" (#564): o modelo (base do jogo ou cálculo ao vivo) e a última análise
  // do usuário, por streaming. Só junto do registro de apostas (o "Adicionar às suas
  // apostas" precisa da lista); falha vira o estado vazio.
  const userId = session.user.id;
  const seuPalpiteP: Promise<SeuPalpiteData> | null =
    caps.seuPalpite && caps.registerBets
    ? loadSeuPalpiteData({
        // Ao vivo (#594, §9.1): a base do APITO (asOf kickoff; sem base usável, o pré-jogo
        // do modelo em jogo já calculado) e a leitura a partir do placar atual.
        base: () =>
          phase.kind === "pre"
            ? resolvePalpiteModelBase(match, { now, liveModel: slipModel })
            : resolvePalpiteModelBase(match, {
                asOf: match.kickoffAt,
                liveModel: async () => inPlayModel,
              }),
        latest: () => getLatestUserPalpiteAnalysis(match.id, userId),
        teams,
        now,
        inPlay:
          phase.kind !== "pre" && inPlayState?.score
            ? inPlayReadingFor({ ...inPlayState, score: inPlayState.score })
            : null,
        onError: (error, err) =>
          console.error(
            JSON.stringify({
              scope: "match-page",
              error,
              message: err instanceof Error ? err.message : String(err),
            })
          ),
      })
    : null;

  // Placar final só pra jogos encerrados com gols reportados (heroView já
  // anulou scores fora de `finished`). Alimenta o recibo settled do HERO + FinishedNotice.
  const finalScore =
    heroView.homeScore !== null && heroView.awayScore !== null
      ? { home: heroView.homeScore, away: heroView.awayScore }
      : null;

  return (
    <>
      {/* 2ª parte do tour guiado: abre sozinha no 1º jogo aberto depois da parte da
          lista (/jogos). */}
      <GuidedTour
        chapter="jogo"
        userId={session.user.id}
        serverState={tourState}
        forceStart={false}
      />
      <MatchLayout
        heroView={heroView}
        initialTab={initialTab}
        sections={sections}
        liveSections={liveSections}
        previousAnalyses={previousAnalyses}
        matchId={match.id}
        fixtureRef={fixtureRef}
        leagueKey={leagueKey}
        unavailableReason={unavailableReason}
        pool={caps.pool}
        registerBets={caps.registerBets}
        analyze={caps.analyze}
        heroLive={heroLive}
        backHref={backHref}
        backLabel={backLabel}
        finalScore={finalScore}
        bestBetEnabled={bestBetEnabled}
        heroPalpite={heroPalpite}
        heroSetId={heroSetId}
        heroSharedAt={heroSharedAt}
        heroLineupNotice={heroLineupNotice}
        homeTeamHref={homeTeamHref}
        awayTeamHref={awayTeamHref}
        betGrid={betGridP}
        seuPalpite={seuPalpiteP}
        userContextEnabled={userContextEnabled}
        contextEnabled={contextEnabled}
        userContextView={userContextView}
        teams={teams}
        hasAnalyses={canRegenerate}
        canOpenAnalysis={canOpenAnalysis}
        liveAnalysis={liveAnalysis}
        noticeDetail={
          liveReadable && inPlayModel === null
            ? "Sem modelo para a leitura ao vivo deste jogo."
            : null
        }
        seuPalpiteClosed={seuPalpiteClosedMessage(phase, {
          liveMode,
          modelReady: inPlayModel !== null,
          hasScore: liveScore !== null,
        })}
      />
    </>
  );
}

type MatchLayoutProps = {
  heroView: MatchHeroView;
  // Aba aberta no SSR (`?aba=`, padrão Mercados).
  initialTab: MatchTab;
  // Última análise por mercado (#243): ≤1 → resultado cru (idêntico ao atual); ≥2 →
  // uma seção colapsável por mercado. Vazio → nenhuma análise ainda.
  sections: MarketAnalysisSectionItem[];
  // Leituras ao vivo (#594): a última de cada mercado, numa seção própria.
  liveSections: MarketAnalysisSectionItem[];
  // Análises anteriores deste jogo (#204): as reanálises mais antigas (não-latest de
  // cada mercado). Renderizadas numa seção colapsável abaixo das seções por-mercado.
  // Vazio → a seção não renderiza.
  previousAnalyses: PreviousAnalysisItem[];
  matchId: string;
  fixtureRef: FixtureRef;
  leagueKey: ReturnType<typeof leagueToKey>;
  // Por que o jogo não aceita análise (null = pré-jogo): escolhe a copy do HERO e do
  // aviso de não-analisável.
  unavailableReason: MatchUnavailableReason | null;
  // Atalho "criar bolão" (matchCapabilities.pool).
  pool: boolean;
  // "Analisar com IA" / "Gerar só o palpite" liberados (matchCapabilities.analyze).
  analyze: boolean;
  // Cabeçalho acompanhando o jogo ao vivo (#580): "Atualizar placar" e a nota sem
  // placar. null = cabeçalho de antes.
  heroLive: { note: string | null } | null;
  // Painel Suas apostas, a barra do celular e o §3 (matchCapabilities.registerBets).
  registerBets: boolean;
  // Href de "voltar" — recompõe a lista filtrada (/jogos?…) de origem; /jogos
  // como fallback (deep-link / sem `back`).
  backHref: string;
  // Texto do "voltar": "jogos" ou o nome do time de origem (#446).
  backLabel: string;
  // Placar final pra jogos encerrados; null caso contrário.
  finalScore: { home: number; away: number } | null;
  // Flag #178/#351: o kill-switch de spend (enable_best_bet_fan_out). Passado ao HERO
  // como `fanOutEnabled` — controla SÓ o botão "Analisar com IA" (não mais a layout, que
  // é palpite-first sempre). Gate efetivo revalidado server-side em analyzeBestBet.
  bestBetEnabled: boolean;
  // Manchete palpite-first do HERO (#351). null = sem palpite ainda → estado empty/CTA.
  heroPalpite: PalpiteHeadlineView | null;
  // #384: id + shared_at do set mais recente, pro botão de compartilhar do HERO. null = sem set.
  heroSetId: string | null;
  heroSharedAt: Date | null;
  heroLineupNotice: string | null;
  // #408: hrefs do histórico de cada time, montados do canonical persistido →
  // passados aos nomes do MatchHero (imunes a mismatch por construção).
  homeTeamHref: string;
  awayTeamHref: string;
  // #556/#576: tabela de mercados (streaming), com registro ou só leitura.
  betGrid: Promise<BetGridView>;
  // #564: bloco "Seu palpite" (streaming), no mesmo provider da lista. null = sem
  // registro de apostas. `userContextEnabled` = kill-switch do "Analisar meu palpite".
  seuPalpite: Promise<SeuPalpiteData> | null;
  userContextEnabled: boolean;
  // #565: campo "Contexto extra" no HERO e o "o que você acrescentou" no detalhe.
  contextEnabled: boolean;
  userContextView: AnalysisUserContextView | null;
  teams: { home: string; away: string };
  // #594: há análises para o "Gerar só o palpite" (ao vivo: leituras ao vivo).
  hasAnalyses: boolean;
  // #594: há análise salva (pré-jogo ou ao vivo) para "Ler análise completa".
  canOpenAnalysis: boolean;
  // #594: a página está na leitura ao vivo (o HERO manda pageLive=1 e muda a copy).
  liveAnalysis: boolean;
  // #594: o motivo do aviso de não-analisável quando o jogo está ao vivo sem modelo.
  noticeDetail: string | null;
  // #594: a copy da aba "Seu palpite" quando ela não abre (por motivo, ao vivo).
  seuPalpiteClosed: string;
};

// Uma árvore responsiva (#576): a mesma ordem no celular e no desktop, com `lg:` dentro
// de cada bloco. Cada componente assíncrono renderiza UMA vez por request e o BetSlip e
// o "Seu palpite" têm uma instância só (o estado da lista não se divide). Nenhuma classe
// que esconde uma árvore inteira por largura (single-tree.test.ts trava a volta).
function MatchLayout({
  heroView,
  initialTab,
  sections,
  liveSections,
  previousAnalyses,
  matchId,
  fixtureRef,
  leagueKey,
  unavailableReason,
  pool,
  registerBets,
  analyze,
  heroLive,
  backHref,
  backLabel,
  finalScore,
  bestBetEnabled,
  heroPalpite,
  heroSetId,
  heroSharedAt,
  heroLineupNotice,
  homeTeamHref,
  awayTeamHref,
  betGrid,
  seuPalpite,
  userContextEnabled,
  contextEnabled,
  userContextView,
  teams,
  hasAnalyses,
  canOpenAnalysis,
  liveAnalysis,
  noticeDetail,
  seuPalpiteClosed,
}: MatchLayoutProps) {
  return (
    // `wide` só com o painel Suas apostas ao lado (a coluna principal fica em ~852px);
    // sem ele (jogo encerrado, adiado, ou em andamento sem o ao vivo), a coluna única
    // volta pra `content`, senão a tabela e os Dados esticariam a ~1216px.
    <PageContainer width={registerBets ? "wide" : "content"}>
      {/* O h1 da página fica aqui, não no MatchHero: em components/ só o PageHeader e o
          PageHeading do admin têm <h1> (page-header-coverage.test.ts). */}
      <h1 className="sr-only">
        {heroView.home.name} × {heroView.away.name}
      </h1>
      <MatchTopBar backHref={backHref} backLabel={backLabel} poolMatchId={pool ? matchId : null} />

      <MatchHero
        view={heroView}
        status={
          heroView.status === "live" || heroView.isInProgress
            ? "live"
            : "scheduled"
        }
        score={finalScore ?? undefined}
        homeHref={homeTeamHref}
        awayHref={awayTeamHref}
        live={heroLive}
      />

      {/* Suas apostas (#556/#576): UM provider envolve a tabela, o painel e o "Seu
          palpite", que manda o palpite pra lista. O painel fica fora do fluxo principal:
          coluna fixa à direita no desktop, barra + folha no celular. */}
      <BetSlipProvider matchId={matchId}>
        <div
          className={cn(
            "pt-4",
            registerBets &&
              "lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6"
          )}
        >
          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            {/* HERO palpite-first (#351), compacto (#576): a manchete sintetizada é a
                PROEMINÊNCIA, logo abaixo da identidade do jogo. "Ler análise completa"
                abre o HERO inteiro e a análise por mercado num bloco IRMÃO, fechado por
                padrão → nenhum número de valor vaza pro HERO (firewall ADR 0030). */}
            <PalpiteArea
              heroPalpite={heroPalpite}
              matchId={matchId}
              unavailable={unavailableReason}
              analyzable={analyze}
              fanOutEnabled={bestBetEnabled}
              finalScore={finalScore}
              setId={heroSetId}
              sharedAt={heroSharedAt}
              lineupNotice={heroLineupNotice}
              hasAnalyses={hasAnalyses}
              canOpenAnalysis={canOpenAnalysis}
              contextEnabled={contextEnabled}
              live={liveAnalysis}
              analysis={
                <FullAnalysis
                  sections={sections}
                  liveSections={liveSections}
                  previousAnalyses={previousAnalyses}
                  userContext={userContextView}
                />
              }
            />
            {!analyze &&
              unavailableReason !== null &&
              sections.length + liveSections.length === 0 && (
              <NotAnalyzableNotice
                reason={unavailableReason}
                score={finalScore}
                detail={noticeDetail}
              />
            )}

            {/* Abas (#576): Mercados (a tabela: odd de mercado, chance e odd justa num
                lugar só, fora do MatchHero/PalpiteHero pela firewall da ADR 0030), Seu
                palpite e Dados. Os três painéis ficam montados; cada slot tem o próprio
                Suspense. */}
            <MatchTabs
              initialTab={initialTab}
              registerBets={registerBets}
              mercados={
                <Suspense fallback={<MarketTableSkeleton />}>
                  <MarketTableSection grid={betGrid} />
                </Suspense>
              }
              seuPalpite={
                seuPalpite ? (
                  <Suspense fallback={<SeuPalpiteSkeleton />}>
                    <SeuPalpiteSection
                      matchId={matchId}
                      teams={teams}
                      data={seuPalpite}
                      aiEnabled={userContextEnabled}
                    />
                  </Suspense>
                ) : (
                  <p className="max-w-reading text-body-sm text-muted-foreground tracking-tight">
                    {seuPalpiteClosed}
                  </p>
                )
              }
              dados={
                <div className="flex flex-col gap-3">
                  <Suspense fallback={<MatchSectionsSkeleton />}>
                    <MatchSections fixtureRef={fixtureRef} leagueKey={leagueKey} />
                  </Suspense>
                  <Suspense fallback={<MatchAuxiliarySkeleton />}>
                    <MatchAuxiliarySections fixtureRef={fixtureRef} />
                  </Suspense>
                </div>
              }
            />
            {registerBets && <SlipMobileRiskNotice />}
          </div>
          {registerBets && <SlipAside />}
        </div>
        {registerBets && <SlipMobileBar />}
      </BetSlipProvider>
    </PageContainer>
  );
}

// Volta pra origem ("jogos" ou o time) à esquerda e o atalho do bolão à direita, numa linha.
function MatchTopBar({
  backHref,
  backLabel,
  poolMatchId,
}: {
  backHref: string;
  backLabel: string;
  poolMatchId: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <BackLink href={backHref} label={backLabel} className="mb-0" />
      {poolMatchId !== null && <PoolLink matchId={poolMatchId} />}
    </div>
  );
}

// Mostrado em vez da CTA de análise quando o jogo não é analisável e não há análise
// salva: predict()/actions rejeitam esses jogos, então não há o que analisar. A copy
// varia pelo motivo (ao vivo / adiado / cancelado / encerrado).
function NotAnalyzableNotice({
  reason,
  score,
  detail: detailOverride = null,
}: {
  reason: MatchUnavailableReason;
  score: { home: number; away: number } | null;
  // Ao vivo sem modelo (#594): o motivo é da capacidade, não do jogo.
  detail?: string | null;
}) {
  const copy = unavailableNoticeCopy(reason, score);
  const label = copy.label;
  const detail = detailOverride ?? copy.detail;
  return (
    <div className="border-border flex flex-col gap-1.5 rounded-md border border-dashed px-4 py-3.5">
      <span className="text-meta tracking-label text-muted-foreground uppercase">
        {label}
      </span>
      <p className="max-w-reading text-body-sm text-muted-foreground tracking-tight">
        {detail}
      </p>
    </div>
  );
}

// Atalho pro bolão entre amigos (#567) com o jogo já escolhido. Aparece enquanto a janela
// do bolão estiver aberta: antes do apito e, no modo ao vivo, até os 15' de jogo.
function PoolLink({ matchId }: { matchId: string }) {
  return (
    <Link
      href={`/bolao?jogo=${matchId}`}
      className="text-body-sm text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-sm tracking-tight focus-visible:ring-[3px] focus-visible:outline-none"
    >
      <Users className="size-3.5" aria-hidden />
      criar bolão
    </Link>
  );
}
