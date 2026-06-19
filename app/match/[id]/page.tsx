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
import { toNwayOddsView, toOddsView } from "@/lib/view/odds";
import type {
  MarketAnalysisSectionItem,
  OddsView,
  PreviousAnalysisItem,
} from "@/lib/view/types";

// Fan-out "melhor aposta" (#178) roda até ~4 predict() SERIAIS num request — no pior
// caso (retries do Anthropic) leva minutos. Estende o budget da rota (Vercel max).
// Uma truncagem por timeout deixa as ≤N predições JÁ persistidas (reais) visíveis no
// próximo load (keepLatestPerMatch), sem retornar a view deste request.
export const maxDuration = 300;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MatchPage({ params }: PageProps) {
  const { id } = await params;
  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const match = await getMatchById(id);
  if (!match) notFound();

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
  const sections: MarketAnalysisSectionItem[] = toMarketAnalysisSections(history);
  const previousAnalyses: PreviousAnalysisItem[] =
    toPreviousAnalysisItems(history);

  const fixtureRef: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  const leagueKey = leagueToKey(match.league);
  // Espelha o gate de predict(): jogos encerrados/cancelados não são
  // analisáveis. A CTA do HERO fica escondida nesses casos pra não submeter um form que
  // o server rejeitaria. Predições/palpites já existentes continuam visíveis.
  const analyzable =
    match.status !== "finished" && match.status !== "cancelled";
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
          finalScore={finalScore}
          bestBetEnabled={bestBetEnabled}
          heroPalpite={heroPalpite}
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
          finalScore={finalScore}
          bestBetEnabled={bestBetEnabled}
          heroPalpite={heroPalpite}
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
  // false em jogos encerrados/cancelados (predict() os rejeita). Esconde a CTA.
  analyzable: boolean;
  // Placar final pra jogos encerrados; null caso contrário.
  finalScore: { home: number; away: number } | null;
  // Flag #178/#351: o kill-switch de spend (enable_best_bet_fan_out). Passado ao HERO
  // como `fanOutEnabled` — controla SÓ o botão "Analisar com IA" (não mais a layout, que
  // é palpite-first sempre). Gate efetivo revalidado server-side em analyzeBestBet.
  bestBetEnabled: boolean;
  // Manchete palpite-first do HERO (#351). null = sem palpite ainda → estado empty/CTA.
  heroPalpite: PalpiteHeadlineView | null;
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
  finalScore,
  bestBetEnabled,
  heroPalpite,
}: Common) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href="/jogos"
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
        status={heroView.status === "live" ? "live" : "scheduled"}
        score={finalScore ?? undefined}
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
        />

        {/* Detalhe por mercado LOGO ABAIXO do palpite: é o "quero ver mais" imediato da
            manchete. Collapsed por padrão → nenhum número de valor vaza pro topo (firewall
            ADR 0030 intacto: edge/EV/stake/odd vivem DENTRO do disclosure). */}
        <NeutralAnalysisDetail
          sections={sections}
          previousAnalyses={previousAnalyses}
        />
        {!analyzable && sections.length === 0 && (
          <FinishedNotice score={finalScore} />
        )}

        {/* Odds (preços de referência) DEPOIS do detalhe — em tela estreita ficam abaixo do
            palpite+análise, sem empurrar a análise pra longe da manchete. */}
        <OddsCard view={oddsView} />
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
  finalScore,
  bestBetEnabled,
  heroPalpite,
}: Common) {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-content px-8 pt-8 pb-16">
        <Link
          href="/jogos"
          className="mb-6 inline-flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-body-sm tracking-tight">jogos</span>
        </Link>

        {/* Identidade do jogo FULL-WIDTH no topo. */}
        <div className="pb-6">
          <MatchHero
            view={heroView}
            status={heroView.status === "live" ? "live" : "scheduled"}
            score={finalScore ?? undefined}
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
          />
          <div className="flex flex-col gap-3 self-start">
            <OddsCard view={oddsView} />
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
            <FinishedNotice score={finalScore} />
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

// Mostrado em vez da CTA de análise quando o jogo já terminou/foi cancelado e
// não há predição prévia: predict() rejeita esses jogos, então não há o que
// analisar. O placar (quando há) reforça o estado encerrado.
function FinishedNotice({
  score,
}: {
  score: { home: number; away: number } | null;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-4 py-3.5">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        jogo encerrado
      </span>
      <p className="text-body-sm text-muted-foreground tracking-tight">
        {score
          ? `Placar final ${score.home}–${score.away}. Análise indisponível para jogos já encerrados.`
          : "Análise indisponível para jogos já encerrados ou cancelados."}
      </p>
    </div>
  );
}
