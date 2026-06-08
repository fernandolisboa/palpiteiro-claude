import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";

import { AnalysisPanel } from "@/components/analysis-panel";
import { DesktopShell } from "@/components/desktop-shell";
import { MatchAuxiliarySections } from "@/components/match-sections-auxiliary";
import { MatchHero } from "@/components/match-hero";
import { MatchSections } from "@/components/match-sections";
import { OddsCard } from "@/components/odds-card";
import { TeamAvatar } from "@/components/team-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  MatchAuxiliarySkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";
import { auth } from "@/auth";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { getMatchById } from "@/lib/db/queries/matches";
import { getLatestPredictionForMatch } from "@/lib/db/queries/predictions";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import { toAnalysisView } from "@/lib/view/analysis";
import { toMatchRowView } from "@/lib/view/match";
import { toOddsView } from "@/lib/view/odds";
import type { OddsView } from "@/lib/view/types";

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

  // Odds e predição existente em paralelo. Ambas são pré-requisito pro
  // render síncrono do hero + odds + panel (não vão pra Suspense).
  const [snapshot, latestPred] = await Promise.all([
    ensureOddsSnapshotsFresh(match),
    getLatestPredictionForMatch(match.id, session.user.id),
  ]);

  const heroView = toMatchRowView({
    match: {
      id: match.id,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
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

  const existingAnalysis = latestPred
    ? toAnalysisView(
        {
          recommendation: latestPred.prediction.recommendation,
          confidencePct: latestPred.prediction.confidencePct,
          rationale: latestPred.prediction.rationale,
          keyFactors: latestPred.prediction.keyFactors,
          minimumOdd: latestPred.prediction.minimumOdd,
          edgePct: latestPred.prediction.edgePct,
          modelVersion: latestPred.prediction.modelVersion,
          promptVersion: latestPred.prediction.promptVersion,
          createdAt: latestPred.prediction.createdAt,
        },
        latestPred.aiCall ? { costUsd: latestPred.aiCall.costUsd } : null,
      )
    : null;

  const fixtureRef: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  const leagueKey = leagueToKey(match.league);
  const oddsAvailable = oddsView !== null;
  const isAdmin = session.user.role === "admin";

  return (
    <>
      <div className="lg:hidden">
        <MobileMatch
          heroView={heroView}
          oddsView={oddsView}
          analysisExisting={existingAnalysis}
          matchId={match.id}
          fixtureRef={fixtureRef}
          leagueKey={leagueKey}
          oddsAvailable={oddsAvailable}
          isAdmin={isAdmin}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopMatch
          heroView={heroView}
          oddsView={oddsView}
          analysisExisting={existingAnalysis}
          matchId={match.id}
          fixtureRef={fixtureRef}
          leagueKey={leagueKey}
          oddsAvailable={oddsAvailable}
          isAdmin={isAdmin}
        />
      </div>
    </>
  );
}

type Common = {
  heroView: ReturnType<typeof toMatchRowView>;
  oddsView: OddsView | null;
  analysisExisting: ReturnType<typeof toAnalysisView> | null;
  matchId: string;
  fixtureRef: FixtureRef;
  leagueKey: ReturnType<typeof leagueToKey>;
  oddsAvailable: boolean;
  isAdmin: boolean;
};

function MobileMatch({
  heroView,
  oddsView,
  analysisExisting,
  matchId,
  fixtureRef,
  leagueKey,
  oddsAvailable,
  isAdmin,
}: Common) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-fg-2">
            match · {matchId.slice(0, 8)}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <MatchHero view={heroView} />

      <div className="flex flex-col gap-3 px-5 pb-6">
        <OddsCard view={oddsView} />
        <AnalysisPanel
          matchId={matchId}
          existing={analysisExisting}
          oddsAvailable={oddsAvailable}
          isAdmin={isAdmin}
        />
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
  analysisExisting,
  matchId,
  fixtureRef,
  leagueKey,
  oddsAvailable,
  isAdmin,
}: Common) {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1100px] px-8 pt-8 pb-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 pb-6 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>

        <div className="grid grid-cols-[1fr_320px] gap-8 pb-8">
          <div>
            <div className="flex items-center gap-3 pb-5">
              <span className="inline-flex h-5 items-center rounded-full border border-border bg-transparent px-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {LEAGUE_LABEL[heroView.league]}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {heroView.when}
              </span>
              {heroView.countdown && (
                <span className="font-mono text-[11px] tabular-nums text-accent-fg">
                  {heroView.countdown}
                </span>
              )}
            </div>
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <TeamAvatar
                  initials={heroView.home.short.slice(0, 2)}
                  hue={heroView.home.hue}
                  size={56}
                />
                <div className="flex flex-col">
                  <span className="text-[22px] font-medium tracking-[-0.02em]">
                    {heroView.home.name}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    casa
                  </span>
                </div>
              </div>
              <span className="text-[22px] font-medium text-muted-foreground tracking-tight">
                vs
              </span>
              <div className="flex items-center gap-3">
                <TeamAvatar
                  initials={heroView.away.short.slice(0, 2)}
                  hue={heroView.away.hue}
                  size={56}
                />
                <div className="flex flex-col">
                  <span className="text-[22px] font-medium tracking-[-0.02em]">
                    {heroView.away.name}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    visitante
                  </span>
                </div>
              </div>
            </div>
            {heroView.venue && (
              <div className="flex items-center gap-4 pt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-fg-2">
                <span>{heroView.venue}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <OddsCard view={oddsView} />
          </div>
        </div>

        <div className="pb-6">
          <AnalysisPanel
            matchId={matchId}
            existing={analysisExisting}
            oddsAvailable={oddsAvailable}
            isAdmin={isAdmin}
          />
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
