import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";

import { MarketAnalysisSections } from "@/components/market-analysis-section";
import { MatchCollapsible } from "@/components/match-collapsible";
import { PreviousAnalyses } from "@/components/previous-analyses";
import { DesktopShell } from "@/components/desktop-shell";
import { MatchAuxiliarySections } from "@/components/match-sections-auxiliary";
import { MatchHero } from "@/components/match-hero";
import { MatchSections } from "@/components/match-sections";
import { OddsCard } from "@/components/odds-card";
import { PalpiteHero } from "@/components/palpites/palpite-hero";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  MatchAuxiliarySkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";
import { auth } from "@/auth";
import { leagueToKey } from "@/lib/format";
import { getEnableBestBetFanOut } from "@/lib/db/queries/ai-config";
import { getMatchById } from "@/lib/db/queries/matches";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";
import { getLatestSelectionOddsSnapshotsForMatches } from "@/lib/db/queries/odds-snapshots";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { PAGE_LIVE_MARKETS } from "@/lib/odds/live-card-markets";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import {
  toMarketAnalysisSections,
  toPreviousAnalysisItems,
} from "@/lib/view/analysis";
import { toMatchRowView } from "@/lib/view/match";
import {
  toPalpiteHeadlineViewFromSet,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { resolveBackHref } from "@/lib/view/back-href";
import { toNwayOddsView, toOddsView } from "@/lib/view/odds";
import type {
  MarketAnalysisSectionItem,
  MatchStatus,
  OddsView,
  PreviousAnalysisItem,
} from "@/lib/view/types";

// Fan-out "melhor aposta" (#178) roda até ~4 predict() SERIAIS num request — no pior
// caso (retries do Anthropic) leva minutos. Estende o budget da rota (Vercel max).
// Uma truncagem por timeout deixa as ≤N predições JÁ persistidas (reais) visíveis no
// próximo load (keepLatestPerMatch), sem retornar a view deste request.
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
  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const match = await getMatchById(id);
  if (!match) notFound();

  // Instante ÚNICO do request: alimenta o gate de analisabilidade (kickoff>now) E
  // o heroView (isInProgress p/ a badge "ao vivo"). Um único `now` garante que o
  // gate e a badge não discordem por milissegundos (#385).
  const now = new Date();

  // Fuso de exibição do usuário (#1) — kickoff/countdown do hero no fuso do navegador.
  const timeZone = await getRequestTimeZone();

  // Pré-aquece over/under + 1X2 ao vivo (#173): featured/batch, +1 crédito de
  // liga por refresh stale (h2h é market separado de totals). Retorna a snapshot
  // over/under LEGADA (contrato inalterado). O card 1X2 lê selection_odds_snapshots
  // DEPOIS do warm — encadeado no ensure (a leitura não pode correr antes da escrita).
  const ensureP = ensureOddsSnapshotsFresh(match, { markets: PAGE_LIVE_MARKETS });
  const matchResultP = ensureP.then(() =>
    getLatestSelectionOddsSnapshotsForMatches([match.id], "match_result"),
  );
  // Odds e predição existente em paralelo. Ambas são pré-requisito pro
  // render síncrono do hero + odds + panel (não vão pra Suspense).
  const [snapshot, matchResultMap, history, palpiteSets, bestBetEnabled] =
    await Promise.all([
      ensureP,
      matchResultP,
      // Histórico COMPLETO: agrupado por mercado em toMarketAnalysisSections (#243, a
      // última de cada mercado = uma seção) e em toPreviousAnalysisItems (as reanálises
      // mais antigas, #204). Scoped por userId (sem leak, AC2).
      getPredictionHistoryForMatch(match.id, session.user.id),
      // Sets de palpite persistidos (#351): só `sets[0]` (o mais recente) alimenta o HERO.
      // A query traz o histórico completo (espelha o painel interim); overhead mínimo —
      // uma query "latest-only" seria follow-up se virar gargalo (PLAN §3.1 nota).
      getPalpiteSetsForMatch(match.id, session.user.id),
      getEnableBestBetFanOut(),
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

  const heroView = toMatchRowView({
    match: {
      id: match.id,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    },
    odds: snapshot
      ? {
          bookmaker: snapshot.bookmaker,
          overOdd: snapshot.overOdd,
          underOdd: snapshot.underOdd,
          capturedAt: snapshot.capturedAt,
        }
      : null,
    hasPrediction: latestPred !== null,
    now,
    timeZone,
  });

  const oddsView: OddsView | null = snapshot
    ? toOddsView({
        bookmaker: snapshot.bookmaker,
        overOdd: snapshot.overOdd,
        underOdd: snapshot.underOdd,
        capturedAt: snapshot.capturedAt,
      })
    : null;

  // Card 1X2 ao vivo (#173): best-effort — captura ausente/incompleta vira null
  // (o reader OMITE, nunca throw) → card simplesmente não é empilhado.
  const matchResultSnapshot = matchResultMap.get(match.id);
  const matchResultOddsView: OddsView | null = matchResultSnapshot
    ? toNwayOddsView(matchResultSnapshot, "match_result")
    : null;

  // Última análise por MERCADO (#243): uma seção colapsável por mercado (≥2) ou o
  // resultado cru (≤1, idêntico ao atual). ANTERIORES (#204) = as reanálises mais
  // antigas (não-latest de cada mercado). Ambas pela MESMA fiação multi-mercado
  // (#170/#173) centralizada em lib/view/analysis, market-agnostic (labels do registry).
  const sections: MarketAnalysisSectionItem[] = toMarketAnalysisSections(
    history,
    new Date(),
    timeZone,
  );
  const previousAnalyses: PreviousAnalysisItem[] = toPreviousAnalysisItems(
    history,
    new Date(),
    timeZone,
  );

  const fixtureRef: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  const leagueKey = leagueToKey(match.league);
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
  const analyzable =
    match.status === "scheduled" && match.kickoffAt.getTime() > now.getTime();
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
      <div className="lg:hidden">
        <MobileMatch
          heroView={heroView}
          oddsView={oddsView}
          matchResultOddsView={matchResultOddsView}
          sections={sections}
          previousAnalyses={previousAnalyses}
          matchId={match.id}
          fixtureRef={fixtureRef}
          leagueKey={leagueKey}
          analyzable={analyzable}
          matchStatus={match.status}
          backHref={backHref}
          finalScore={finalScore}
          bestBetEnabled={bestBetEnabled}
          heroPalpite={heroPalpite}
          heroSetId={heroSetId}
          heroSharedAt={heroSharedAt}
          homeTeamHref={homeTeamHref}
          awayTeamHref={awayTeamHref}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopMatch
          heroView={heroView}
          oddsView={oddsView}
          matchResultOddsView={matchResultOddsView}
          sections={sections}
          previousAnalyses={previousAnalyses}
          matchId={match.id}
          fixtureRef={fixtureRef}
          leagueKey={leagueKey}
          analyzable={analyzable}
          matchStatus={match.status}
          backHref={backHref}
          finalScore={finalScore}
          bestBetEnabled={bestBetEnabled}
          heroPalpite={heroPalpite}
          heroSetId={heroSetId}
          heroSharedAt={heroSharedAt}
          homeTeamHref={homeTeamHref}
          awayTeamHref={awayTeamHref}
        />
      </div>
    </>
  );
}

type Common = {
  heroView: ReturnType<typeof toMatchRowView>;
  oddsView: OddsView | null;
  // Card 1X2 ao vivo empilhado abaixo do over/under (#173). null = sem captura
  // h2h pra este match (best-effort) → não renderiza o 2º card.
  matchResultOddsView: OddsView | null;
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
  // false em jogos não-`scheduled` (live/postponed/finished/cancelled — predict()
  // os rejeita). Esconde a CTA.
  analyzable: boolean;
  // Status cru do jogo: escolhe a copy do empty-state (OddsCard) e do aviso de
  // não-analisável (live vs adiado vs encerrado).
  matchStatus: MatchStatus;
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
};

function MobileMatch({
  heroView,
  oddsView,
  matchResultOddsView,
  sections,
  previousAnalyses,
  matchId,
  fixtureRef,
  leagueKey,
  analyzable,
  matchStatus,
  backHref,
  finalScore,
  bestBetEnabled,
  heroPalpite,
  heroSetId,
  heroSharedAt,
  homeTeamHref,
  awayTeamHref,
}: Common) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href={backHref}
          className="flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-body-sm tracking-tight">jogos</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-eyebrow-xs uppercase tracking-eyebrow text-muted-fg-2">
            match · {matchId.slice(0, 8)}
          </span>
          <ThemeToggle />
        </div>
      </header>

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
          analyzable={analyzable}
          fanOutEnabled={bestBetEnabled}
          finalScore={finalScore}
          setId={heroSetId}
          sharedAt={heroSharedAt}
        />

        {/* Detalhe por mercado LOGO ABAIXO do palpite: é o "quero ver mais" imediato da
            manchete. Collapsed por padrão → nenhum número de valor vaza pro topo (firewall
            ADR 0030 intacto: edge/EV/stake/odd vivem DENTRO do disclosure). */}
        <NeutralAnalysisDetail
          sections={sections}
          previousAnalyses={previousAnalyses}
        />
        {!analyzable && sections.length === 0 && (
          <NotAnalyzableNotice status={matchStatus} score={finalScore} />
        )}

        {/* Odds (preços de referência) DEPOIS do detalhe — em tela estreita ficam abaixo do
            palpite+análise, sem empurrar a análise pra longe da manchete. */}
        <OddsCard view={oddsView} matchStatus={matchStatus} />
        {matchResultOddsView && <OddsCard view={matchResultOddsView} />}

        <Suspense fallback={<MatchSectionsSkeleton />}>
          <MatchSections fixtureRef={fixtureRef} leagueKey={leagueKey} />
        </Suspense>
        <Suspense fallback={<MatchAuxiliarySkeleton />}>
          <MatchAuxiliarySections fixtureRef={fixtureRef} />
        </Suspense>
      </div>
    </div>
  );
}

function DesktopMatch({
  heroView,
  oddsView,
  matchResultOddsView,
  sections,
  previousAnalyses,
  matchId,
  fixtureRef,
  leagueKey,
  analyzable,
  matchStatus,
  backHref,
  finalScore,
  bestBetEnabled,
  heroPalpite,
  heroSetId,
  heroSharedAt,
  homeTeamHref,
  awayTeamHref,
}: Common) {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-content px-8 pt-8 pb-16">
        <Link
          href={backHref}
          className="mb-6 inline-flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-body-sm tracking-tight">jogos</span>
        </Link>

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

        {/* Grid [1fr_320px]: à ESQUERDA o palpite (a manchete), à DIREITA as odds (preços
            de referência). SEM items-start → stretch padrão: o card do palpite acompanha a
            altura da coluna de odds (altura mínima = odds). Se o palpite for MAIOR, ele cresce
            naturalmente e a coluna de odds NÃO estica (`self-start`). Nada de truncar/scroll/
            colapsar — só min-height casada. */}
        <div className="grid grid-cols-[1fr_320px] gap-8 pb-6">
          <PalpiteHero
            heroPalpite={heroPalpite}
            matchId={matchId}
            analyzable={analyzable}
            fanOutEnabled={bestBetEnabled}
            finalScore={finalScore}
            setId={heroSetId}
            sharedAt={heroSharedAt}
          />
          <div className="flex flex-col gap-3 self-start">
            <OddsCard view={oddsView} matchStatus={matchStatus} />
            {matchResultOddsView && <OddsCard view={matchResultOddsView} />}
          </div>
        </div>

        {/* Detalhe por mercado FULL-WIDTH abaixo do grid: collapsed por padrão, ocupa a
            largura toda ao expandir (não fica preso na coluna do palpite). Fica logo abaixo
            da manchete (o palpite é o elemento alto do grid). Firewall ADR 0030 intacto: é
            disclosure collapsed; edge/EV/stake vivem DENTRO dele, nada de valor no HERO. */}
        <div className="flex flex-col gap-3 pb-6">
          <NeutralAnalysisDetail
            sections={sections}
            previousAnalyses={previousAnalyses}
          />
          {!analyzable && sections.length === 0 && (
            <NotAnalyzableNotice status={matchStatus} score={finalScore} />
          )}
        </div>

        <Suspense fallback={<MatchSectionsSkeleton />}>
          <MatchSections fixtureRef={fixtureRef} leagueKey={leagueKey} />
        </Suspense>
        <Suspense fallback={<MatchAuxiliarySkeleton />}>
          <MatchAuxiliarySections fixtureRef={fixtureRef} />
        </Suspense>
      </div>
    </DesktopShell>
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
// (predictions-best-bet.test.ts o pina). O HERO usa só `palpite`/`ok`/`error` do action.
function NeutralAnalysisDetail({
  sections,
  previousAnalyses,
}: {
  sections: MarketAnalysisSectionItem[];
  previousAnalyses: PreviousAnalysisItem[];
}) {
  if (sections.length === 0) return null;
  return (
    <MatchCollapsible title="ver análise por mercado">
      <div className="flex flex-col gap-3">
        <MarketAnalysisSections sections={sections} />
        <PreviousAnalyses items={previousAnalyses} />
      </div>
    </MatchCollapsible>
  );
}

// Copy do aviso de não-analisável POR status — mesma informação/tom de
// notAnalyzableMessage das actions (aqui em label+detail pra o card; lá numa
// string só). live → "antes do apito"; postponed → "até ser remarcado"; o resto
// (finished/cancelled) → encerrado, com placar quando há.
function notAnalyzableNoticeCopy(
  status: MatchStatus,
  score: { home: number; away: number } | null,
): { label: string; detail: string } {
  if (status === "live") {
    return {
      label: "jogo em andamento",
      detail: "A análise fica disponível só antes do apito inicial.",
    };
  }
  if (status === "postponed") {
    return {
      label: "jogo adiado",
      detail: "Análise indisponível até o jogo ser remarcado.",
    };
  }
  return {
    label: "jogo encerrado",
    detail: score
      ? `Placar final ${score.home}–${score.away}. Análise indisponível para jogos já encerrados.`
      : "Análise indisponível para jogos já encerrados ou cancelados.",
  };
}

// Mostrado em vez da CTA de análise quando o jogo não é analisável (não-`scheduled`)
// e não há predição prévia: predict()/actions rejeitam esses jogos, então não há o
// que analisar. A copy varia por status (ao vivo / adiado / encerrado).
function NotAnalyzableNotice({
  status,
  score,
}: {
  status: MatchStatus;
  score: { home: number; away: number } | null;
}) {
  const { label, detail } = notAnalyzableNoticeCopy(status, score);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-4 py-3.5">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <p className="text-body-sm text-muted-foreground tracking-tight">{detail}</p>
    </div>
  );
}
