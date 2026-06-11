import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";

import { Card } from "@/components/ui/card";
import { DesktopShell } from "@/components/desktop-shell";
import { LeagueTabs } from "@/components/league-tabs";
import { PageHeader } from "@/components/page-header";
import { RecentPredCard } from "@/components/recent-pred-card";
import { SectionLabel } from "@/components/section-label";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import { UpcomingMatchesMobile } from "@/components/upcoming-matches-mobile";
import { auth } from "@/auth";
import {
  DEFAULT_LEAGUE_FILTER,
  isActiveLeagueFilter,
} from "@/lib/config/active-leagues";
import { getMatchIdsWithPredictionsByUser } from "@/lib/db/queries/matches";
import { loadRangeMatches } from "@/lib/db/queries/load-range-matches";
import { getLatestOddsSnapshotsForMatches } from "@/lib/db/queries/odds-snapshots";
import { getRecentPredictionsByUser } from "@/lib/db/queries/predictions";
import { DateRangeTabs } from "@/components/date-range-tabs";
import { parseRangeParams, type ResolvedRange } from "@/lib/view/date-range";
import { rangeEmptyMessage, rangeLabel } from "@/lib/view/range-href";
import { toMatchRowView } from "@/lib/view/match";
import { toRecentPredictionView } from "@/lib/view/recent-prediction";
import {
  parseLeagueFilter,
  type LeagueFilter,
  type MatchRowView,
  type RecentPredictionView,
} from "@/lib/view/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

const RECENT_LIMIT = 5;

// Cap pra ranges ilimitados (season): evita varrer a competição inteira numa
// query só. Presets de janela já são limitados pelo `to`.
const RANGE_LIMIT = 200;

type PageProps = {
  searchParams: Promise<{
    league?: string;
    preset?: string;
    from?: string;
    to?: string;
  }>;
};

function filterToLeague(filter: LeagueFilter): SupportedLeague | undefined {
  if (filter === "bsa") return "brasileirao_a";
  if (filter === "ucl") return "champions_league";
  if (filter === "wc") return "world_cup";
  return undefined;
}

export default async function HomePage({ searchParams }: PageProps) {
  const {
    league: leagueParam,
    preset: presetParam,
    from: fromParam,
    to: toParam,
  } = await searchParams;
  // "no param" e param inválido caem em "all"; aplicamos o default ANTES de checar
  // atividade pra evitar loop de redirect (/ → / → /). Só keys válidas-mas-inativas
  // (bsa/ucl enquanto fora de temporada) redirecionam pra home limpa.
  const parsed = parseLeagueFilter(leagueParam);
  const league = parsed === "all" ? DEFAULT_LEAGUE_FILTER : parsed;
  if (!isActiveLeagueFilter(league)) redirect("/");

  // Range escolhido pelo usuário (5/14 dias, competição ou custom). Nunca lança
  // — input inválido cai pro default today5.
  const range = parseRangeParams({
    preset: presetParam,
    from: fromParam,
    to: toParam,
  });

  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";

  const matchesQuery = {
    from: range.from,
    to: range.to,
    league: filterToLeague(league),
    statuses: range.statuses,
    order: range.order,
    limit: RANGE_LIMIT,
  };

  const dbMatches = await loadRangeMatches(matchesQuery);

  const matchIds = dbMatches.map((m) => m.id);
  const [snapshotByMatch, predictedMatchIds, recentRaw] = await Promise.all([
    getLatestOddsSnapshotsForMatches(matchIds),
    getMatchIdsWithPredictionsByUser({
      matchIds,
      userId,
    }),
    getRecentPredictionsByUser(userId, RECENT_LIMIT),
  ]);

  const now = new Date();
  const matches: MatchRowView[] = dbMatches.map((m) => {
    const snapshot = snapshotByMatch.get(m.id);
    return toMatchRowView({
      match: {
        id: m.id,
        league: m.league,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffAt: m.kickoffAt,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
      },
      odds: snapshot
        ? {
            bookmaker: snapshot.bookmaker,
            overOdd: snapshot.overOdd,
            underOdd: snapshot.underOdd,
            capturedAt: snapshot.capturedAt,
          }
        : null,
      hasPrediction: predictedMatchIds.has(m.id),
      now,
    });
  });

  const recents: RecentPredictionView[] = recentRaw.map((r) =>
    toRecentPredictionView({
      predictionId: r.predictionId,
      matchId: r.matchId,
      league: r.league,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      recommendation: r.recommendation,
      edgePct: r.edgePct,
      createdAt: r.createdAt,
    }),
  );

  return (
    <>
      <div className="lg:hidden">
        <MobileHome
          matches={matches}
          recents={recents}
          league={league}
          range={range}
          isAdmin={isAdmin}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopHome
          matches={matches}
          recents={recents}
          league={league}
          range={range}
          isAdmin={isAdmin}
        />
      </div>
    </>
  );
}

type HomeContentProps = {
  matches: MatchRowView[];
  recents: RecentPredictionView[];
  league: LeagueFilter;
  range: ResolvedRange;
  // Gateia o link de admin no drawer mobile (mesmo gate da nav desktop).
  // DesktopHome ignora — a nav dele vive no DesktopShell.
  isAdmin: boolean;
};

// Props compartilhadas pra preservar o range ao trocar de liga nas tabs.
function rangeNavProps(range: ResolvedRange) {
  const from = range.from
    ? range.from.toISOString().slice(0, 10)
    : undefined;
  const to = range.to ? range.to.toISOString().slice(0, 10) : undefined;
  return { preset: range.preset, from, to };
}

function MobileHome({
  matches,
  recents,
  league,
  range,
  isAdmin,
}: HomeContentProps) {
  const label = rangeLabel(range);
  const empty = rangeEmptyMessage(range);
  const navProps = rangeNavProps(range);
  // Remonta a lista ao trocar de filtro (liga/range) pra resetar o reveal.
  const listKey = `${league}-${range.preset}-${navProps.from ?? ""}-${navProps.to ?? ""}`;
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <PageHeader
        isAdmin={isAdmin}
        subtitle={`${matches.length} jogos · ${label.toLowerCase()}`}
      />
      <div className="px-5 pb-5 pt-1">
        <h1 className="text-[26px] font-medium leading-[1.05] tracking-[-0.03em]">
          Próximos jogos
        </h1>
        <p className="pt-1.5 text-[13px] text-muted-foreground tracking-tight">
          Over / under 2.5 — análise sob demanda.
        </p>
      </div>

      <div className="flex flex-col gap-2 px-5 pb-3">
        <LeagueTabs value={league} range={navProps} />
        <DateRangeTabs
          league={league}
          preset={range.preset}
          from={navProps.from}
          to={navProps.to}
        />
      </div>

      <SectionLabel>{label}</SectionLabel>
      {matches.length === 0 ? (
        <Card className="mx-5">
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="text-muted-fg-2">
              <Inbox className="size-9" strokeWidth={1.25} />
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium tracking-tight">
                {empty.title}
              </span>
              <span className="max-w-[240px] text-[12.5px] text-muted-foreground tracking-tight">
                {empty.detail}
              </span>
            </div>
          </div>
        </Card>
      ) : (
        <UpcomingMatchesMobile key={listKey} matches={matches} />
      )}

      <div className="pt-7" />
      <SectionLabel
        action={
          <Link
            href="/dashboard"
            className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ver todas →
          </Link>
        }
      >
        Suas predições recentes
      </SectionLabel>
      <div className="overflow-x-auto px-5 pb-6">
        {recents.length === 0 ? (
          <div className="text-[12.5px] text-muted-foreground tracking-tight">
            Nenhuma predição ainda.
          </div>
        ) : (
          <div className="flex gap-2">
            {recents.map((p) => (
              <RecentPredCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DesktopHome({ matches, recents, league, range }: HomeContentProps) {
  const label = rangeLabel(range);
  const empty = rangeEmptyMessage(range);
  const navProps = rangeNavProps(range);
  // Remonta a grade ao trocar de filtro (liga/range) pra resetar o reveal.
  const listKey = `${league}-${range.preset}-${navProps.from ?? ""}-${navProps.to ?? ""}`;
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1040px] px-8 pt-10 pb-16">
        <div className="flex items-end justify-between pb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-medium leading-[1] tracking-[-0.035em]">
              Próximos jogos
            </h1>
            <p className="text-[13.5px] text-muted-foreground tracking-tight">
              {matches.length} partidas · {label} · Copa do Mundo FIFA 2026
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <LeagueTabs value={league} range={navProps} />
            <DateRangeTabs
              league={league}
              preset={range.preset}
              from={navProps.from}
              to={navProps.to}
            />
          </div>
        </div>

        {matches.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3">
              <span className="text-muted-fg-2">
                <Inbox className="size-10" strokeWidth={1.25} />
              </span>
              <span className="text-[15px] font-medium tracking-tight">
                {empty.title}
              </span>
              <span className="text-[13px] text-muted-foreground tracking-tight">
                {empty.detail}
              </span>
            </div>
          </Card>
        ) : (
          <UpcomingMatchesDesktop key={listKey} matches={matches} />
        )}

        <div className="pt-12">
          <div className="flex items-baseline justify-between pb-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
              suas predições recentes
            </span>
            <Link
              href="/dashboard"
              className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
            >
              ver todas →
            </Link>
          </div>
          {recents.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground tracking-tight">
              Nenhuma predição ainda.
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-3">
              {recents.map((p) => (
                <RecentPredCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );
}
