import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";

import { AnalysisPanel } from "@/components/analysis-panel";
import { MarketAnalysisSections } from "@/components/market-analysis-section";
import { BestBetPanel } from "@/components/best-bet-panel";
import { PreviousAnalyses } from "@/components/previous-analyses";
import { DesktopShell } from "@/components/desktop-shell";
import { MatchAuxiliarySections } from "@/components/match-sections-auxiliary";
import { MatchHero } from "@/components/match-hero";
import { MatchSections } from "@/components/match-sections";
import { OddsCard } from "@/components/odds-card";
import { PalpiteAutoRun } from "@/components/palpites/palpite-auto-run";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  MatchAuxiliarySkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";
import { auth } from "@/auth";
import { MODEL_REGISTRY, modelsForAudience } from "@/lib/ai/models";
import { leagueToKey } from "@/lib/format";
import {
  getDefaultModelId,
  getEnableBestBetFanOut,
} from "@/lib/db/queries/ai-config";
import {
  marketsForAudience,
  marketsForLeague,
} from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";
import { getPreferredModelId } from "@/lib/db/queries/users";
import { getLatestSelectionOddsSnapshotsForMatches } from "@/lib/db/queries/odds-snapshots";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { PAGE_LIVE_MARKETS } from "@/lib/odds/live-card-markets";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import {
  toMarketAnalysisSections,
  toPreviousAnalysisItems,
} from "@/lib/view/analysis";
import { toMatchRowView } from "@/lib/view/match";
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

  const isAdmin = session.user.role === "admin";

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
  const [
    snapshot,
    matchResultMap,
    history,
    defaultModelId,
    preferredModelId,
    audienceMarkets,
    bestBetEnabled,
  ] = await Promise.all([
    ensureP,
    matchResultP,
    // Histórico COMPLETO: agrupado por mercado em toMarketAnalysisSections (#243, a
    // última de cada mercado = uma seção) e em toPreviousAnalysisItems (as reanálises
    // mais antigas, #204). Scoped por userId (sem leak, AC2).
    getPredictionHistoryForMatch(match.id, session.user.id),
    getDefaultModelId(),
    getPreferredModelId(session.user.id),
    marketsForAudience(isAdmin),
    getEnableBestBetFanOut(),
  ]);
  const defaultModelLabel = MODEL_REGISTRY[defaultModelId].label;
  const latestPred = history[0] ?? null;

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
      {/* Auto-geração de palpites na entrada do jogo (#315). ZERO UI; idempotente no
          servidor. Fora dos wrappers mobile/desktop pra montar UMA vez só (ambos
          ficam no DOM via CSS). O painel/lista que consome os sets é #316. */}
      <PalpiteAutoRun matchId={match.id} />
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
          oddsAvailable={oddsAvailable}
          analyzable={analyzable}
          finalScore={finalScore}
          selectableModels={selectableModels}
          selectableMarkets={selectableMarkets}
          defaultModelLabel={defaultModelLabel}
          preferredModelId={preferredModelId}
          bestBetEnabled={bestBetEnabled}
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
          oddsAvailable={oddsAvailable}
          analyzable={analyzable}
          finalScore={finalScore}
          selectableModels={selectableModels}
          selectableMarkets={selectableMarkets}
          defaultModelLabel={defaultModelLabel}
          preferredModelId={preferredModelId}
          bestBetEnabled={bestBetEnabled}
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
  // Flag #178: a CTA "Analisar todos os mercados" (fan-out cross-mercado) só aparece
  // com a flag ligada E ≥2 mercados candidatos. Gate efetivo revalidado em analyzeBestBet.
  bestBetEnabled: boolean;
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
  oddsAvailable,
  analyzable,
  finalScore,
  selectableModels,
  selectableMarkets,
  defaultModelLabel,
  preferredModelId,
  bestBetEnabled,
}: Common) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href="/"
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
        <OddsCard view={oddsView} />
        {matchResultOddsView && <OddsCard view={matchResultOddsView} />}
        {analyzable ? (
          <AnalysisPanel
            matchId={matchId}
            sections={sections}
            oddsAvailable={oddsAvailable}
            selectableModels={selectableModels}
            selectableMarkets={selectableMarkets}
            defaultModelLabel={defaultModelLabel}
            preferredModelId={preferredModelId}
            previous={previousAnalyses}
          />
        ) : sections.length > 0 ? (
          // Jogo encerrado/cancelado com predição já gerada: mostra o resultado
          // em modo somente-leitura (sem CTA de reanálise — predict() rejeitaria).
          // ≤1 mercado → resultado cru; ≥2 → uma seção colapsável por mercado (#243).
          // Histórico (#204) abaixo TAMBÉM aparece aqui (inclusão deliberada além do
          // AC): sem pending no caminho encerrado, a seção é sempre visível. Wrapper
          // flex próprio pra espaçar seções↔anteriores (não depende do gap do pai).
          <div className="flex flex-col gap-3">
            <MarketAnalysisSections sections={sections} />
            <PreviousAnalyses items={previousAnalyses} />
          </div>
        ) : (
          <FinishedNotice score={finalScore} />
        )}
        {analyzable && bestBetEnabled && selectableMarkets.length > 1 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="font-mono text-eyebrow-xs uppercase tracking-eyebrow text-muted-fg-2">
              melhor aposta do jogo
            </span>
            <BestBetPanel matchId={matchId} />
          </div>
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
  matchResultOddsView,
  sections,
  previousAnalyses,
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
  bestBetEnabled,
}: Common) {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-content px-8 pt-8 pb-16">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-body-sm tracking-tight">jogos</span>
        </Link>

        <div className="grid grid-cols-[1fr_320px] gap-8 pb-8">
          <MatchHero
            view={heroView}
            status={heroView.status === "live" ? "live" : "scheduled"}
            score={finalScore ?? undefined}
          />

          <div className="flex flex-col gap-3">
            <OddsCard view={oddsView} />
            {matchResultOddsView && <OddsCard view={matchResultOddsView} />}
          </div>
        </div>

        <div className="pb-6">
          {analyzable ? (
            <AnalysisPanel
              matchId={matchId}
              sections={sections}
              oddsAvailable={oddsAvailable}
              selectableModels={selectableModels}
              selectableMarkets={selectableMarkets}
              defaultModelLabel={defaultModelLabel}
              preferredModelId={preferredModelId}
              previous={previousAnalyses}
            />
          ) : sections.length > 0 ? (
            // Encerrado/cancelado com predição: somente-leitura (sem reanálise). ≤1
            // mercado → resultado cru; ≥2 → uma seção colapsável por mercado (#243).
            // Histórico (#204) abaixo TAMBÉM aqui (inclusão deliberada além do AC);
            // wrapper flex próprio pra espaçar seções↔anteriores.
            <div className="flex flex-col gap-3">
              <MarketAnalysisSections sections={sections} />
              <PreviousAnalyses items={previousAnalyses} />
            </div>
          ) : (
            <FinishedNotice score={finalScore} />
          )}
        </div>

        {analyzable && bestBetEnabled && selectableMarkets.length > 1 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 pb-6">
            <span className="font-mono text-eyebrow-xs uppercase tracking-eyebrow text-muted-fg-2">
              melhor aposta do jogo
            </span>
            <BestBetPanel matchId={matchId} />
          </div>
        )}

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
