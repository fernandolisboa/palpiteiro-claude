import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft, Users } from "lucide-react";

import { MarketAnalysisSections } from "@/components/market-analysis-section";
import { MatchCollapsible } from "@/components/match-collapsible";
import { PreviousAnalyses } from "@/components/previous-analyses";
import { MatchAuxiliarySections } from "@/components/match-sections-auxiliary";
import { MatchHero } from "@/components/match-hero";
import {
  MatchModelReading,
  MatchModelReadingSkeleton,
} from "@/components/match-model-reading";
import { MatchSections } from "@/components/match-sections";
import {
  MatchOddsCards,
  type MatchOddsViews,
} from "@/components/match-odds-cards";
import { PalpiteHero } from "@/components/palpites/palpite-hero";
import { AnalysisUserContext } from "@/components/analysis-user-context";
import { readAnalysisEngine } from "@/lib/ai/engine/analysis-engine-flag";
import {
  toAnalysisUserContextView,
  type AnalysisUserContextView,
} from "@/lib/view/analysis-user-context";
import { GuidedTour } from "@/components/tour/guided-tour";
import {
  MatchAuxiliarySkeleton,
  MatchOddsSkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";
import {
  BetSlipSection,
  BetSlipSkeleton,
} from "@/components/bet-slip-section";
import { BetSlipBridgeProvider } from "@/components/bet-slip-bridge";
import {
  SeuPalpiteSection,
  SeuPalpiteSkeleton,
} from "@/components/seu-palpite-section";
import { auth } from "@/auth";
import { leagueToKey } from "@/lib/format";
import { teamToTeam } from "@/lib/view/team";
import {
  getEnableBestBetFanOut,
  getEnableUserContext,
} from "@/lib/db/queries/ai-config";
import { latestAnalysisByMarket } from "@/lib/bets/analysis-probs";
import { resolveSlipModel } from "@/lib/bets/slip-model";
import { getReferenceOddsForMatch } from "@/lib/db/queries/reference-odds";
import { toBetGridView, type BetGridView } from "@/lib/view/bet-slip";
import { getMatchById } from "@/lib/db/queries/matches";
import { getTourState } from "@/lib/db/queries/users";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";
import { getLatestUserPalpiteAnalysis } from "@/lib/db/queries/user-palpite-analyses";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { resolvePalpiteModelBase } from "@/lib/user-palpite/model-base";
import {
  loadSeuPalpiteData,
  type SeuPalpiteData,
} from "@/lib/view/user-palpite";
import { getLatestSelectionOddsSnapshotsForMatches } from "@/lib/db/queries/odds-snapshots";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { PAGE_LIVE_MARKETS } from "@/lib/odds/live-card-markets";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import {
  toMarketAnalysisSections,
  toPreviousAnalysisItems,
} from "@/lib/view/analysis";
import { loadMatchModelReading } from "@/lib/model-base/reading";
import { toMatchHeroView } from "@/lib/view/match";
import {
  matchUnavailableReason,
  unavailableNoticeCopy,
  type MatchUnavailableReason,
} from "@/lib/view/match-availability";
import {
  toPalpiteHeadlineViewFromSet,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { resolveBackHref } from "@/lib/view/back-href";
import { toNwayOddsView, toOddsView } from "@/lib/view/odds";
import type {
  MarketAnalysisSectionItem,
  MatchHeroView,
  MatchModelReadingView,
  PreviousAnalysisItem,
} from "@/lib/view/types";

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
  searchParams: Promise<{ back?: string }>;
};

export default async function MatchPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  // "Voltar" preserva o estado de busca da origem: recompõe a URL a partir do
  // param `back` (validado anti open-redirect; fallback /jogos). Um jogo pode ser
  // aberto da lista /jogos OU do histórico de um time (/time/[team], #408) — ambas
  // as bases são aceitas; fallback = /jogos (origem default).
  const backHref = resolveBackHref((await searchParams).back, ["/jogos", "/time"]);
  // Middleware garante sessão; redirect defensivo caso o matcher mude. Sessão e jogo
  // são independentes: buscados juntos (cada um é um round trip ao banco).
  const [session, match] = await Promise.all([auth(), getMatchById(id)]);
  if (!session?.user?.id) redirect("/signin");
  if (!match) notFound();

  // Instante ÚNICO do request: alimenta o gate de analisabilidade (kickoff>now) E
  // o heroView (isInProgress p/ a badge "ao vivo"). Um único `now` garante que o
  // gate e a badge não discordem por milissegundos (#385).
  const now = new Date();

  // Fuso de exibição do usuário (#1) — kickoff/countdown do hero no fuso do navegador.
  const timeZone = await getRequestTimeZone();

  // Nome de EXIBIÇÃO dos times nos rótulos de 1X2/dupla chance (#574): cards de odds,
  // análises e leitura do modelo. Não confundir com `teams` (canônico) mais abaixo.
  const leagueKey = leagueToKey(match.league);
  const displayTeams = {
    home: teamToTeam(match.homeTeam, leagueKey).name,
    away: teamToTeam(match.awayTeam, leagueKey).name,
  };

  // Pré-aquece over/under + 1X2 ao vivo (#173): featured/batch, +1 crédito de
  // liga por refresh stale (h2h é market separado de totals). Retorna a snapshot
  // over/under LEGADA (contrato inalterado). O card 1X2 lê selection_odds_snapshots
  // DEPOIS do warm — encadeado no ensure (a leitura não pode correr antes da escrita).
  //
  // FORA do caminho crítico: com o snapshot vencido o refresh espera a The Odds API, e
  // só os cards de odds dependem dele (o hero não mostra odd). A página renderiza sem
  // esperar e os cards chegam por streaming (MatchOddsCards em Suspense). Criada UMA vez
  // aqui e compartilhada pelas árvores mobile e desktop: um refresh só.
  const oddsP: Promise<MatchOddsViews> = ensureOddsSnapshotsFresh(match, {
    markets: PAGE_LIVE_MARKETS,
  }).then(async (snapshot) => {
    const matchResultMap = await getLatestSelectionOddsSnapshotsForMatches(
      [match.id],
      "match_result",
    );
    // Card 1X2 ao vivo (#173): best-effort — captura ausente/incompleta vira null
    // (o reader OMITE, nunca throw) → card simplesmente não é empilhado.
    const matchResultSnapshot = matchResultMap.get(match.id);
    return {
      oddsView: snapshot
        ? toOddsView({
            bookmaker: snapshot.bookmaker,
            overOdd: snapshot.overOdd,
            underOdd: snapshot.underOdd,
            capturedAt: snapshot.capturedAt,
          })
        : null,
      matchResultOddsView: matchResultSnapshot
        ? toNwayOddsView(matchResultSnapshot, "match_result", undefined, displayTeams)
        : null,
    };
  }).catch((err: unknown): MatchOddsViews => {
    // Provider/rede já viram null dentro do ensure; aqui sobra erro de DB. Com a página já
    // na tela, deixar rejeitar trocaria tudo pelo error.tsx na hidratação: degrada pro
    // empty-state "Odds indisponíveis", como as outras seções em streaming.
    console.error(
      JSON.stringify({
        scope: "match-page",
        error: "odds_refresh_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { oddsView: null, matchResultOddsView: null };
  });
  // Predição existente e demais leituras em paralelo: pré-requisito pro render
  // síncrono do hero + panel.
  const [
    history,
    palpiteSets,
    bestBetEnabled,
    tourState,
    userContextEnabled,
    analysisEngine,
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
    ]);
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
    },
    // O hero não mostra odd (os cards de odds chegam por streaming, oddsP acima).
    odds: null,
    hasPrediction: latestPred !== null,
    now,
    timeZone,
  });

  // Última análise por MERCADO (#243): uma seção colapsável por mercado (≥2) ou o
  // resultado cru (≤1, idêntico ao atual). ANTERIORES (#204) = as reanálises mais
  // antigas (não-latest de cada mercado). Ambas pela MESMA fiação multi-mercado
  // (#170/#173) centralizada em lib/view/analysis, market-agnostic (labels do registry).
  const sections: MarketAnalysisSectionItem[] = toMarketAnalysisSections(
    history,
    new Date(),
    timeZone,
    displayTeams,
  );
  const previousAnalyses: PreviousAnalysisItem[] = toPreviousAnalysisItems(
    history,
    new Date(),
    timeZone,
    displayTeams,
  );

  // "Contexto extra (opcional)" no HERO (#565): kill-switch E motor code_jev (a action
  // confere de novo). "O que você acrescentou" vem da análise visível.
  const contextEnabled = userContextEnabled && analysisEngine === "code_jev";
  const userContextView = toAnalysisUserContextView(
    history,
    { home: match.homeTeam, away: match.awayTeam },
    now,
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
  const unavailableReason = matchUnavailableReason(
    match.status,
    match.kickoffAt,
    now,
  );
  const analyzable = unavailableReason === null;

  // Leitura do modelo (#555, ADR 0052): a base do jogo, lida do banco (sem odd, sem
  // chamada externa) e entregue por streaming. Só em jogo analisável: ao vivo e
  // encerrado ficam fora. Criada UMA vez e compartilhada pelas árvores mobile/desktop.
  const modelReading = analyzable
    ? loadMatchModelReading({ matchId: match.id, now, teams: displayTeams })
    : null;

  // "Registrar apostas" (#556): grade de mercados + lista, só antes do apito (a action
  // rejeitaria o resto). FORA do caminho crítico, UMA promise pras duas árvores: o
  // modelo do jogo (porta única, lib/bets/slip-model) começa já; as odds de referência
  // são lidas do banco DEPOIS do refresh que a página já faz (oddsP) — nenhuma chamada
  // nova à Odds API. Falha vira grade sem odds/sem modelo (os botões ainda registram).
  const teams = { home: match.homeTeam, away: match.awayTeam };
  // O modelo ao vivo é calculado UMA vez e compartilhado pela grade e pelo "Seu palpite"
  // (que só cai nele quando não há base fresca do jogo).
  let slipModelP: Promise<ModelScoreline | null> | null = null;
  const slipModel = () => (slipModelP ??= resolveSlipModel(match));
  const betGridP: Promise<BetGridView> | null = analyzable
    ? Promise.all([
        slipModel(),
        oddsP.then(() => getReferenceOddsForMatch(match.id)),
      ])
        .then(([model, references]) =>
          toBetGridView({
            teams,
            model,
            references,
            analysis: latestAnalysisByMarket(history),
          }),
        )
        .catch((err: unknown): BetGridView => {
          console.error(
            JSON.stringify({
              scope: "match-page",
              error: "bet_grid_failed",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
          return toBetGridView({
            teams,
            model: null,
            references: new Map(),
            analysis: new Map(),
          });
        })
    : null;

  // "Seu palpite" (#564): o modelo (base do jogo ou cálculo ao vivo) e a última análise
  // do usuário, por streaming. Só em jogo analisável; falha vira o estado vazio.
  const userId = session.user.id;
  const seuPalpiteP: Promise<SeuPalpiteData> | null = analyzable
    ? loadSeuPalpiteData({
        base: () => resolvePalpiteModelBase(match, { now, liveModel: slipModel }),
        latest: () => getLatestUserPalpiteAnalysis(match.id, userId),
        teams,
        now,
        onError: (error, err) =>
          console.error(
            JSON.stringify({
              scope: "match-page",
              error,
              message: err instanceof Error ? err.message : String(err),
            }),
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
      {/* Palpite-first (ADR 0030 / #351): a manchete sintetizada é o HERO no topo; as
          análises por mercado viram detalhe recolhível NEUTRO abaixo. Layout única (sem
          flag de apresentação) — o botão "Analisar com IA" do HERO dispara o fan-out →
          síntese → revalidatePath. `analyzeBestBet` segue gated por enable_best_bet_fan_out
          como kill-switch de spend (go-live = o dono flipa a flag). */}
      {/* 2ª parte do tour guiado: abre sozinha no 1º jogo aberto depois da parte da
          lista (/jogos). */}
      <GuidedTour
        chapter="jogo"
        userId={session.user.id}
        serverState={tourState}
        forceStart={false}
      />
      <div className="lg:hidden">
        <MobileMatch
          heroView={heroView}
          odds={oddsP}
          modelReading={modelReading}
          sections={sections}
          previousAnalyses={previousAnalyses}
          matchId={match.id}
          fixtureRef={fixtureRef}
          leagueKey={leagueKey}
          unavailableReason={unavailableReason}
          backHref={backHref}
          finalScore={finalScore}
          bestBetEnabled={bestBetEnabled}
          heroPalpite={heroPalpite}
          heroSetId={heroSetId}
          heroSharedAt={heroSharedAt}
          homeTeamHref={homeTeamHref}
          awayTeamHref={awayTeamHref}
          betGrid={betGridP}
          seuPalpite={seuPalpiteP}
          userContextEnabled={userContextEnabled}
          contextEnabled={contextEnabled}
          userContextView={userContextView}
          teams={teams}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopMatch
          heroView={heroView}
          odds={oddsP}
          modelReading={modelReading}
          sections={sections}
          previousAnalyses={previousAnalyses}
          matchId={match.id}
          fixtureRef={fixtureRef}
          leagueKey={leagueKey}
          unavailableReason={unavailableReason}
          backHref={backHref}
          finalScore={finalScore}
          bestBetEnabled={bestBetEnabled}
          heroPalpite={heroPalpite}
          heroSetId={heroSetId}
          heroSharedAt={heroSharedAt}
          homeTeamHref={homeTeamHref}
          awayTeamHref={awayTeamHref}
          betGrid={betGridP}
          seuPalpite={seuPalpiteP}
          userContextEnabled={userContextEnabled}
          contextEnabled={contextEnabled}
          userContextView={userContextView}
          teams={teams}
        />
      </div>
    </>
  );
}

type Common = {
  heroView: MatchHeroView;
  // Cards de odds (over/under + 1X2 ao vivo, #173), resolvidos fora do caminho crítico
  // e renderizados por streaming. A MESMA promise nas duas árvores.
  odds: Promise<MatchOddsViews>;
  // Leitura do modelo (#555): só em jogo analisável (null nos demais → não renderiza).
  modelReading: Promise<MatchModelReadingView | null> | null;
  // Última análise por mercado (#243): ≤1 → resultado cru (idêntico ao atual); ≥2 →
  // uma seção colapsável por mercado. Vazio → nenhuma análise ainda.
  sections: MarketAnalysisSectionItem[];
  // Análises anteriores deste jogo (#204): as reanálises mais antigas (não-latest de
  // cada mercado). Renderizadas numa seção colapsável abaixo das seções por-mercado
  // (oculta durante pending no painel; sempre visível no caminho encerrado). Vazio → a
  // seção não renderiza.
  previousAnalyses: PreviousAnalysisItem[];
  matchId: string;
  fixtureRef: FixtureRef;
  leagueKey: ReturnType<typeof leagueToKey>;
  // Por que o jogo não aceita análise (null = pré-jogo): escolhe a copy do HERO, do
  // aviso de não-analisável e do empty-state do OddsCard.
  unavailableReason: MatchUnavailableReason | null;
  // Href de "voltar" — recompõe a lista filtrada (/jogos?…) de origem; /jogos
  // como fallback (deep-link / sem `back`).
  backHref: string;
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
  // #408: hrefs do histórico de cada time, montados do canonical persistido →
  // passados aos nomes do MatchHero (imunes a mismatch por construção).
  homeTeamHref: string;
  awayTeamHref: string;
  // #556: grade de "Registrar apostas" (streaming). null = jogo não analisável (a
  // seção não aparece).
  betGrid: Promise<BetGridView> | null;
  // #564: bloco "Seu palpite" (streaming), na mesma ponte da grade. null = jogo não
  // analisável. `userContextEnabled` = kill-switch do "Analisar meu palpite".
  seuPalpite: Promise<SeuPalpiteData> | null;
  userContextEnabled: boolean;
  // #565: campo "Contexto extra" no HERO e o "o que você acrescentou" no detalhe.
  contextEnabled: boolean;
  userContextView: AnalysisUserContextView | null;
  teams: { home: string; away: string };
};

function MobileMatch({
  heroView,
  odds,
  modelReading,
  sections,
  previousAnalyses,
  matchId,
  fixtureRef,
  leagueKey,
  unavailableReason,
  backHref,
  finalScore,
  bestBetEnabled,
  heroPalpite,
  heroSetId,
  heroSharedAt,
  homeTeamHref,
  awayTeamHref,
  betGrid,
  seuPalpite,
  userContextEnabled,
  contextEnabled,
  userContextView,
  teams,
}: Common) {
  return (
    <div className="bg-background text-foreground">
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href={backHref}
          className="flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-body-sm tracking-tight">jogos</span>
        </Link>
        {unavailableReason === null && <PoolLink matchId={matchId} />}
      </div>

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
      />

      <div className="flex flex-col gap-3 px-5 pb-6">
        {/* HERO palpite-first (#351): a manchete sintetizada é a PROEMINÊNCIA, logo
            abaixo da identidade do jogo. O botão dispara o fan-out → síntese. */}
        <PalpiteHero
          heroPalpite={heroPalpite}
          matchId={matchId}
          unavailable={unavailableReason}
          fanOutEnabled={bestBetEnabled}
          finalScore={finalScore}
          setId={heroSetId}
          sharedAt={heroSharedAt}
          hasAnalyses={sections.length > 0}
          contextEnabled={contextEnabled}
        />

        {/* Detalhe por mercado LOGO ABAIXO do palpite: é o "quero ver mais" imediato da
            manchete. Collapsed por padrão → nenhum número de valor vaza pro topo (firewall
            ADR 0030 intacto: edge/EV/stake/odd vivem DENTRO do disclosure). */}
        <NeutralAnalysisDetail
          sections={sections}
          previousAnalyses={previousAnalyses}
          userContext={userContextView}
        />
        {unavailableReason !== null && sections.length === 0 && (
          <NotAnalyzableNotice reason={unavailableReason} score={finalScore} />
        )}

        {/* Odds (preços de referência) DEPOIS do detalhe — em tela estreita ficam abaixo do
            palpite+análise, sem empurrar a análise pra longe da manchete. */}
        <div className="flex flex-col gap-3" data-tour="odds">
          <Suspense fallback={<MatchOddsSkeleton />}>
            <MatchOddsCards odds={odds} unavailable={unavailableReason} />
          </Suspense>
        </div>

        {/* Leitura do modelo (#555): probabilidade e odd justa, sem valor. Fora do
            MatchHero/PalpiteHero (firewall ADR 0030). */}
        {modelReading && (
          <div className="flex flex-col gap-3">
            <Suspense fallback={<MatchModelReadingSkeleton />}>
              <MatchModelReading reading={modelReading} />
            </Suspense>
          </div>
        )}

        {/* Seu palpite (#564) + Registrar apostas (#556): a ponte deixa o "Seu palpite"
            mandar o palpite pra lista "Suas apostas" desta árvore. */}
        {betGrid && (
          <BetSlipBridgeProvider>
            {seuPalpite && (
              <Suspense fallback={<SeuPalpiteSkeleton />}>
                <SeuPalpiteSection
                  matchId={matchId}
                  teams={teams}
                  data={seuPalpite}
                  aiEnabled={userContextEnabled}
                  variant="mobile"
                />
              </Suspense>
            )}
            <Suspense fallback={<BetSlipSkeleton />}>
              <BetSlipSection matchId={matchId} grid={betGrid} variant="mobile" />
            </Suspense>
          </BetSlipBridgeProvider>
        )}

        <div className="flex flex-col gap-3" data-tour="match-stats">
          <Suspense fallback={<MatchSectionsSkeleton />}>
            <MatchSections fixtureRef={fixtureRef} leagueKey={leagueKey} />
          </Suspense>
          <Suspense fallback={<MatchAuxiliarySkeleton />}>
            <MatchAuxiliarySections fixtureRef={fixtureRef} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function DesktopMatch({
  heroView,
  odds,
  modelReading,
  sections,
  previousAnalyses,
  matchId,
  fixtureRef,
  leagueKey,
  unavailableReason,
  backHref,
  finalScore,
  bestBetEnabled,
  heroPalpite,
  heroSetId,
  heroSharedAt,
  homeTeamHref,
  awayTeamHref,
  betGrid,
  seuPalpite,
  userContextEnabled,
  contextEnabled,
  userContextView,
  teams,
}: Common) {
  return (
    <>
      <div className="mx-auto w-full max-w-content px-8 pt-8 pb-16">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-3.5" />
            <span className="text-body-sm tracking-tight">jogos</span>
          </Link>
          {unavailableReason === null && <PoolLink matchId={matchId} />}
        </div>

        {/* Identidade do jogo FULL-WIDTH no topo. */}
        <div className="pb-6">
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
          />
        </div>

        {/* Palpite FULL-WIDTH, com a própria altura. Antes ficava num grid [1fr_320px]
            esticado até a altura das odds empilhadas à direita: no estado vazio o card era
            quase todo espaço em branco. */}
        <div className="pb-4">
          <PalpiteHero
            heroPalpite={heroPalpite}
            matchId={matchId}
            unavailable={unavailableReason}
            fanOutEnabled={bestBetEnabled}
            finalScore={finalScore}
            setId={heroSetId}
            sharedAt={heroSharedAt}
            hasAnalyses={sections.length > 0}
            contextEnabled={contextEnabled}
          />
        </div>

        {/* Odds (preços de referência) LADO A LADO logo abaixo: over/under e 1X2 na mesma
            linha, mesma altura (stretch do grid). Sem o 1X2, o over/under ocupa metade. */}
        <div className="mb-6 grid grid-cols-2 gap-3" data-tour="odds">
          <Suspense fallback={<MatchOddsSkeleton />}>
            <MatchOddsCards odds={odds} unavailable={unavailableReason} />
          </Suspense>
        </div>

        {/* Leitura do modelo (#555) FULL-WIDTH abaixo das odds: probabilidade e odd
            justa, sem valor. Fora do MatchHero/PalpiteHero (firewall ADR 0030). */}
        {modelReading && (
          <div className="mb-6">
            <Suspense fallback={<MatchModelReadingSkeleton />}>
              <MatchModelReading reading={modelReading} />
            </Suspense>
          </div>
        )}

        {/* Detalhe por mercado FULL-WIDTH abaixo das odds: collapsed por padrão, ocupa a
            largura toda ao expandir. Firewall ADR 0030 intacto: é
            disclosure collapsed; edge/EV/stake vivem DENTRO dele, nada de valor no HERO. */}
        <div className="flex flex-col gap-3 pb-6">
          <NeutralAnalysisDetail
            sections={sections}
            previousAnalyses={previousAnalyses}
            userContext={userContextView}
          />
          {unavailableReason !== null && sections.length === 0 && (
            <NotAnalyzableNotice reason={unavailableReason} score={finalScore} />
          )}
        </div>

        {/* Registrar apostas (#556): seção própria, separada da análise, com a lista
            "Suas apostas" fixa à direita. */}
        {betGrid && (
          <div className="flex flex-col gap-6 pb-8">
            <BetSlipBridgeProvider>
              {seuPalpite && (
                <Suspense fallback={<SeuPalpiteSkeleton />}>
                  <SeuPalpiteSection
                    matchId={matchId}
                    teams={teams}
                    data={seuPalpite}
                    aiEnabled={userContextEnabled}
                    variant="desktop"
                  />
                </Suspense>
              )}
              <Suspense fallback={<BetSlipSkeleton />}>
                <BetSlipSection matchId={matchId} grid={betGrid} variant="desktop" />
              </Suspense>
            </BetSlipBridgeProvider>
          </div>
        )}

        <div data-tour="match-stats">
          <Suspense fallback={<MatchSectionsSkeleton />}>
            <MatchSections fixtureRef={fixtureRef} leagueKey={leagueKey} />
          </Suspense>
          <Suspense fallback={<MatchAuxiliarySkeleton />}>
            <MatchAuxiliarySections fixtureRef={fixtureRef} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

// Detalhe NEUTRO por mercado (#351, §3.3): o MatchCollapsible (chrome neutro — a costura
// cromática) envolve o MarketAnalysisSections em modo READ-ONLY (sem analyzable/matchId →
// sem footer de reanálise; o botão do HERO re-roda tudo). PreviousAnalyses (#204) dentro
// do mesmo detalhe. Os números de valor (edge/EV/stake/odd) são conteúdo LEGÍTIMO aqui —
// o firewall só barra o HERO. Renderiza só quando há análise (sections.length > 0).
//
// O `view` retornado por analyzeBestBet é IGNORADO de propósito: o detalhe vem do
// `sections` revalidado (não-stale), e o contrato #353 do action não pode ser tocado
// (predictions-best-bet.test.ts o pina). O HERO usa só `ok`/`error`/`palpiteError` do action.
function NeutralAnalysisDetail({
  sections,
  previousAnalyses,
  userContext,
}: {
  sections: MarketAnalysisSectionItem[];
  previousAnalyses: PreviousAnalysisItem[];
  // "O que você acrescentou" (#565): o contexto extra da análise visível.
  userContext: AnalysisUserContextView | null;
}) {
  if (sections.length === 0) return null;
  return (
    <MatchCollapsible title="ver análise por mercado">
      <div className="flex flex-col gap-3">
        {userContext && <AnalysisUserContext view={userContext} />}
        <MarketAnalysisSections sections={sections} />
        <PreviousAnalyses items={previousAnalyses} />
      </div>
    </MatchCollapsible>
  );
}

// Mostrado em vez da CTA de análise quando o jogo não é analisável e não há análise
// salva: predict()/actions rejeitam esses jogos, então não há o que analisar. A copy
// varia pelo motivo (ao vivo / adiado / cancelado / encerrado).
function NotAnalyzableNotice({
  reason,
  score,
}: {
  reason: MatchUnavailableReason;
  score: { home: number; away: number } | null;
}) {
  const { label, detail } = unavailableNoticeCopy(reason, score);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-4 py-3.5">
      <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <p className="text-body-sm text-muted-foreground tracking-tight">{detail}</p>
    </div>
  );
}

// Atalho pro bolão entre amigos (#567) com o jogo já escolhido. Só antes do apito: as
// apostas do bolão fecham no início do jogo.
function PoolLink({ matchId }: { matchId: string }) {
  return (
    <Link
      href={`/bolao?jogo=${matchId}`}
      className="inline-flex items-center gap-1.5 rounded-sm text-body-sm tracking-tight text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Users className="size-3.5" aria-hidden />
      criar bolão
    </Link>
  );
}
