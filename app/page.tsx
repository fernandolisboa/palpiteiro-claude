import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Inbox, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DesktopShell } from "@/components/desktop-shell";
import { LeagueTabs } from "@/components/league-tabs";
import { MatchRow } from "@/components/match-row";
import { PageHeader } from "@/components/page-header";
import { RecentPredCard } from "@/components/recent-pred-card";
import { SectionLabel } from "@/components/section-label";
import { TeamAvatar } from "@/components/team-avatar";
import { DEV_USER_ID } from "@/lib/auth/dev-user";
import {
  DEFAULT_LEAGUE_FILTER,
  LIST_WINDOW_HOURS,
  isActiveLeagueFilter,
} from "@/lib/config/active-leagues";
import { LEAGUE_LABEL } from "@/lib/format";
import {
  getMatchIdsWithPredictionsByUser,
  getUpcomingMatches,
} from "@/lib/db/queries/matches";
import { getLatestOddsSnapshotsForMatches } from "@/lib/db/queries/odds-snapshots";
import { getRecentPredictionsByUser } from "@/lib/db/queries/predictions";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";
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

type PageProps = {
  searchParams: Promise<{ league?: string }>;
};

function filterToLeague(filter: LeagueFilter): SupportedLeague | undefined {
  if (filter === "bsa") return "brasileirao_a";
  if (filter === "ucl") return "champions_league";
  if (filter === "wc") return "world_cup";
  return undefined;
}

export default async function HomePage({ searchParams }: PageProps) {
  const { league: leagueParam } = await searchParams;
  // "no param" e param inválido caem em "all"; aplicamos o default ANTES de checar
  // atividade pra evitar loop de redirect (/ → / → /). Só keys válidas-mas-inativas
  // (bsa/ucl enquanto fora de temporada) redirecionam pra home limpa.
  const parsed = parseLeagueFilter(leagueParam);
  const league = parsed === "all" ? DEFAULT_LEAGUE_FILTER : parsed;
  if (!isActiveLeagueFilter(league)) redirect("/");

  let dbMatches = await getUpcomingMatches({
    windowHours: LIST_WINDOW_HOURS,
    league: filterToLeague(league),
  });

  if (dbMatches.length === 0) {
    // Sync sob demanda quando o DB está vazio. O lock processo-local em
    // ensureUpcomingFixturesSynced evita stampede em requests concorrentes.
    try {
      await ensureUpcomingFixturesSynced();
      dbMatches = await getUpcomingMatches({
        windowHours: LIST_WINDOW_HOURS,
        league: filterToLeague(league),
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          scope: "home-page",
          error: "sync_failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const matchIds = dbMatches.map((m) => m.id);
  const [snapshotByMatch, predictedMatchIds, recentRaw] = await Promise.all([
    getLatestOddsSnapshotsForMatches(matchIds),
    getMatchIdsWithPredictionsByUser({
      matchIds,
      userId: DEV_USER_ID,
    }),
    getRecentPredictionsByUser(DEV_USER_ID, RECENT_LIMIT),
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
        <MobileHome matches={matches} recents={recents} league={league} />
      </div>
      <div className="hidden lg:block">
        <DesktopHome matches={matches} recents={recents} league={league} />
      </div>
    </>
  );
}

type HomeContentProps = {
  matches: MatchRowView[];
  recents: RecentPredictionView[];
  league: LeagueFilter;
};

function MobileHome({ matches, recents, league }: HomeContentProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader subtitle={`${matches.length} jogos · 5 dias`} />
      <div className="px-5 pb-5 pt-1">
        <h1 className="text-[26px] font-medium leading-[1.05] tracking-[-0.03em]">
          Próximos jogos
        </h1>
        <p className="pt-1.5 text-[13px] text-muted-foreground tracking-tight">
          Over / under 2.5 — análise sob demanda.
        </p>
      </div>

      <div className="px-5 pb-3">
        <LeagueTabs value={league} />
      </div>

      <SectionLabel>Próximos 5 dias</SectionLabel>
      {matches.length === 0 ? (
        <Card className="mx-5">
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="text-muted-fg-2">
              <Inbox className="size-9" strokeWidth={1.25} />
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium tracking-tight">
                Sem jogos nos próximos 5 dias
              </span>
              <span className="max-w-[240px] text-[12.5px] text-muted-foreground tracking-tight">
                Copa do Mundo sem partidas agendadas nessa janela. Volte mais perto do próximo jogo.
              </span>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mx-5 gap-0 overflow-hidden p-0">
          {matches.map((m, i) => (
            <MatchRow key={m.id} m={m} last={i === matches.length - 1} />
          ))}
        </Card>
      )}

      <div className="pt-7" />
      <SectionLabel
        action={
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {recents.length} / {RECENT_LIMIT}
          </span>
        }
      >
        Suas predições recentes
      </SectionLabel>
      <div className="-mx-5 overflow-x-auto px-5 pb-6">
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

function DesktopHome({ matches, recents, league }: HomeContentProps) {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1040px] px-8 pt-10 pb-16">
        <div className="flex items-end justify-between pb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-medium leading-[1] tracking-[-0.035em]">
              Próximos jogos
            </h1>
            <p className="text-[13.5px] text-muted-foreground tracking-tight">
              {matches.length} partidas nos próximos 5 dias · Copa do Mundo FIFA 2026
            </p>
          </div>
          <LeagueTabs value={league} />
        </div>

        {matches.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3">
              <span className="text-muted-fg-2">
                <Inbox className="size-10" strokeWidth={1.25} />
              </span>
              <span className="text-[15px] font-medium tracking-tight">
                Sem jogos nos próximos 5 dias
              </span>
              <span className="text-[13px] text-muted-foreground tracking-tight">
                Copa do Mundo sem partidas agendadas nessa janela. Volte mais perto do próximo jogo.
              </span>
            </div>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden p-0">
            <div className="grid grid-cols-[160px_1fr_160px_140px_40px] gap-4 border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>liga · kickoff</span>
              <span>jogo</span>
              <span className="text-right">odds</span>
              <span className="text-right">status</span>
              <span />
            </div>
            {matches.map((m, i) => (
              <Link
                key={m.id}
                href={`/match/${m.id}`}
                className={`grid grid-cols-[160px_1fr_160px_140px_40px] items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 ${
                  i === matches.length - 1 ? "" : "border-b border-border-subtle"
                }`}
              >
                <div className="flex flex-col gap-1">
                  <Badge
                    variant="outline"
                    className="h-[18px] w-fit rounded-full px-2 text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {LEAGUE_LABEL[m.league]}
                  </Badge>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {m.kickoff}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <TeamAvatar initials={m.home.short.slice(0, 2)} hue={m.home.hue} size={22} />
                    <span className="text-[14px] font-medium tracking-tight">{m.home.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TeamAvatar initials={m.away.short.slice(0, 2)} hue={m.away.hue} size={22} />
                    <span className="text-[14px] font-medium tracking-tight">{m.away.name}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 font-mono text-[13px] tabular-nums">
                  {m.odds ? (
                    <>
                      <span>
                        <span className="text-muted-foreground">O</span> {m.odds.over}
                      </span>
                      <span>
                        <span className="text-muted-foreground">U</span> {m.odds.under}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-fg-2">sem odd</span>
                  )}
                </div>
                <div className="flex items-center justify-end">
                  {m.hasPrediction ? (
                    <Badge
                      variant="outline"
                      className="h-[20px] rounded-full border-accent-border bg-accent-soft px-2 text-[10px] text-accent-fg"
                    >
                      <Check className="size-3" /> analisado
                    </Badge>
                  ) : (
                    <span className="font-mono text-[10.5px] text-muted-fg-2">—</span>
                  )}
                </div>
                <span className="justify-self-end text-muted-fg-2">
                  <ChevronRight className="size-3.5" />
                </span>
              </Link>
            ))}
          </Card>
        )}

        <div className="pt-12">
          <div className="flex items-baseline justify-between pb-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
              suas predições recentes
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {recents.length} / {RECENT_LIMIT}
            </span>
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
