import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";

import { AnalysisPanel } from "@/components/analysis-panel";
import { AnalysisResult } from "@/components/analysis-result";
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
import { MODEL_REGISTRY, modelsForAudience } from "@/lib/ai/models";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { getDefaultModelId } from "@/lib/db/queries/ai-config";
import {
  marketsForAudience,
  marketsForLeague,
} from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import { getLatestPredictionForMatch } from "@/lib/db/queries/predictions";
import { getPreferredModelId } from "@/lib/db/queries/users";
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

  const isAdmin = session.user.role === "admin";

  // Odds e predição existente em paralelo. Ambas são pré-requisito pro
  // render síncrono do hero + odds + panel (não vão pra Suspense).
  const [snapshot, latestPred, defaultModelId, preferredModelId, audienceMarkets] =
    await Promise.all([
      ensureOddsSnapshotsFresh(match),
      getLatestPredictionForMatch(match.id, session.user.id),
      getDefaultModelId(),
      getPreferredModelId(session.user.id),
      marketsForAudience(isAdmin),
    ]);
  const defaultModelLabel = MODEL_REGISTRY[defaultModelId].label;

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

  const existingAnalysis = latestPred
    ? toAnalysisView(
        {
          recommendation: latestPred.prediction.recommendation,
          confidencePct: latestPred.prediction.confidencePct,
          rationale: latestPred.prediction.rationale,
          keyFactors: latestPred.prediction.keyFactors,
          minimumOdd: latestPred.prediction.minimumOdd,
          oddAtRecommendation: latestPred.prediction.oddAtRecommendation,
          bookmaker: latestPred.prediction.bookmaker,
          impliedProbPct: latestPred.prediction.impliedProbPct,
          edgePct: latestPred.prediction.edgePct,
          overOddAtPrediction: latestPred.prediction.overOddAtPrediction,
          underOddAtPrediction: latestPred.prediction.underOddAtPrediction,
          modelVersion: latestPred.prediction.modelVersion,
          promptVersion: latestPred.prediction.promptVersion,
          createdAt: latestPred.prediction.createdAt,
          // Fiação multi-mercado (#170). marketId null (histórica sem backfill)
          // → coalesce 'over_under', o único mercado ativo. `line` da forma do
          // mercado salva (marketParams); cai pra defaultLine no mapper se null.
          marketKey: latestPred.marketKey ?? "over_under",
          line: latestPred.prediction.marketParams?.line ?? null,
          stakeUnits: latestPred.prediction.stakeUnits,
          // Candidate set N-vias da PSO (#173): reabrir uma predição 1X2 passada
          // renderiza a grade de 3. over/under (2 rows) cai no caminho binário.
          selections: latestPred.selections,
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
  // Espelha o gate de predict(): jogos encerrados/cancelados não são
  // analisáveis. A CTA fica escondida nesses casos pra não submeter um form que
  // o server rejeitaria. Predições já existentes continuam visíveis.
  const analyzable =
    match.status !== "finished" && match.status !== "cancelled";
  // Placar final só pra jogos encerrados com gols reportados (heroView já
  // anulou scores fora de `finished`).
  const finalScore =
    heroView.homeScore !== null && heroView.awayScore !== null
      ? { home: heroView.homeScore, away: heroView.awayScore }
      : null;
  // Lista de override por audiência (ADR 0013), serializável ({id,label}) pra
  // cruzar a fronteira Server→Client. O gate efetivo é revalidado em analyzeMatch.
  const selectableModels = modelsForAudience(isAdmin).map((m) => ({
    id: m.id,
    label: m.label,
  }));
  // Mercados selecionáveis = audiência ∩ cobertura de liga (#158): btts só aparece
  // em ligas com odds validadas (world_cup). {key,label} serializável. Vazio/≤1 →
  // seletor escondido (default over_under). O gate efetivo é re-validado em analyzeMatch.
  const selectableMarkets = marketsForLeague(audienceMarkets, match.league);

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
          analyzable={analyzable}
          finalScore={finalScore}
          selectableModels={selectableModels}
          selectableMarkets={selectableMarkets}
          defaultModelLabel={defaultModelLabel}
          preferredModelId={preferredModelId}
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
          analyzable={analyzable}
          finalScore={finalScore}
          selectableModels={selectableModels}
          selectableMarkets={selectableMarkets}
          defaultModelLabel={defaultModelLabel}
          preferredModelId={preferredModelId}
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
  // false em jogos encerrados/cancelados (predict() os rejeita). Esconde a CTA.
  analyzable: boolean;
  // Placar final pra jogos encerrados; null caso contrário.
  finalScore: { home: number; away: number } | null;
  selectableModels: { id: string; label: string }[];
  // Mercados que esta audiência pode escolher ({key,label} serializável). ≤1 →
  // seletor escondido no painel (default over_under). Gate revalidado no server.
  selectableMarkets: { key: string; label: string }[];
  defaultModelLabel: string;
  preferredModelId: string | null;
};

function MobileMatch({
  heroView,
  oddsView,
  analysisExisting,
  matchId,
  fixtureRef,
  leagueKey,
  oddsAvailable,
  analyzable,
  finalScore,
  selectableModels,
  selectableMarkets,
  defaultModelLabel,
  preferredModelId,
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

      <MatchHero
        view={heroView}
        status={heroView.status === "live" ? "live" : "scheduled"}
        score={finalScore ?? undefined}
      />

      <div className="flex flex-col gap-3 px-5 pb-6">
        <OddsCard view={oddsView} />
        {analyzable ? (
          <AnalysisPanel
            matchId={matchId}
            existing={analysisExisting}
            oddsAvailable={oddsAvailable}
            selectableModels={selectableModels}
            selectableMarkets={selectableMarkets}
            defaultModelLabel={defaultModelLabel}
            preferredModelId={preferredModelId}
          />
        ) : analysisExisting ? (
          // Jogo encerrado/cancelado com predição já gerada: mostra o resultado
          // em modo somente-leitura (sem CTA de reanálise — predict() rejeitaria).
          <AnalysisResult view={analysisExisting} again={false} />
        ) : (
          <FinishedNotice score={finalScore} />
        )}
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
  analyzable,
  finalScore,
  selectableModels,
  selectableMarkets,
  defaultModelLabel,
  preferredModelId,
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
              {finalScore ? (
                <div className="flex flex-col items-center gap-0.5">
                  <span className="font-mono text-[30px] font-medium tabular-nums tracking-tight">
                    {finalScore.home}
                    <span className="px-2 text-muted-foreground">–</span>
                    {finalScore.away}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-fg-2">
                    encerrado
                  </span>
                </div>
              ) : (
                <span className="text-[22px] font-medium text-muted-foreground tracking-tight">
                  vs
                </span>
              )}
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
          {analyzable ? (
            <AnalysisPanel
              matchId={matchId}
              existing={analysisExisting}
              oddsAvailable={oddsAvailable}
              selectableModels={selectableModels}
              selectableMarkets={selectableMarkets}
              defaultModelLabel={defaultModelLabel}
              preferredModelId={preferredModelId}
            />
          ) : analysisExisting ? (
            // Encerrado/cancelado com predição: somente-leitura (sem reanálise).
            <AnalysisResult view={analysisExisting} again={false} />
          ) : (
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
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        jogo encerrado
      </span>
      <p className="text-[12.5px] text-muted-foreground tracking-tight">
        {score
          ? `Placar final ${score.home}–${score.away}. Análise indisponível para jogos já encerrados.`
          : "Análise indisponível para jogos já encerrados ou cancelados."}
      </p>
    </div>
  );
}
