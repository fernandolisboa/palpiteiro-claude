import Link from "next/link";
import { ChevronRight, TriangleAlert, Inbox, RefreshCcw, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopShell } from "@/components/desktop-shell";
import { LeagueTabs } from "@/components/league-tabs";
import { MatchRow, MatchRowSkeleton } from "@/components/match-row";
import { PageHeader } from "@/components/page-header";
import { RecentPredCard } from "@/components/recent-pred-card";
import { SectionLabel } from "@/components/section-label";
import { TeamAvatar } from "@/components/team-avatar";
import {
  FIXTURES,
  LEAGUE_LABEL,
  RECENT_PREDS,
  filterFixturesByLeague,
  parseLeagueFilter,
  type Fixture,
  type LeagueFilter,
} from "@/lib/fixtures";

type PreviewState = "loading" | "empty" | "error" | null;

function parsePreviewState(input: string | string[] | undefined): PreviewState {
  const v = Array.isArray(input) ? input[0] : input;
  if (v === "loading" || v === "empty" || v === "error") return v;
  return null;
}

type PageProps = {
  searchParams: Promise<{ state?: string; league?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const { state, league: leagueParam } = await searchParams;
  const preview = parsePreviewState(state);
  const league = parseLeagueFilter(leagueParam);
  return (
    <>
      <div className="lg:hidden">
        <MobileHome preview={preview} league={league} />
      </div>
      <div className="hidden lg:block">
        <DesktopHome preview={preview} league={league} />
      </div>
    </>
  );
}

function previewSubtitle(preview: PreviewState) {
  if (preview === "loading") return "carregando…";
  if (preview === "empty") return "0 jogos";
  if (preview === "error") return "—";
  return `${FIXTURES.length} jogos · 48h`;
}

function MobileHome({ preview, league }: { preview: PreviewState; league: LeagueFilter }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader subtitle={previewSubtitle(preview)} />
      <div className="px-5 pb-5 pt-1">
        <h1 className="text-[26px] font-medium leading-[1.05] tracking-[-0.03em]">
          Próximos jogos
        </h1>
        {preview !== "empty" && preview !== "error" && (
          <p className="pt-1.5 text-[13px] text-muted-foreground tracking-tight">
            Over / under 2.5 — análise sob demanda.
          </p>
        )}
      </div>

      <div className="px-5 pb-3">
        <LeagueTabs value={league} preserveState={preview} />
      </div>

      {preview === "loading" && <MobileLoading />}
      {preview === "empty" && <MobileEmpty />}
      {preview === "error" && <MobileError />}
      {!preview && <MobileDefault league={league} />}

      <div className="pt-7" />
      <SectionLabel
        action={
          preview === "loading" ? undefined : (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              5 / 5
            </span>
          )
        }
      >
        Suas predições recentes
      </SectionLabel>
      <div className="-mx-5 overflow-x-auto px-5 pb-6">
        <div className="flex gap-2">
          {preview === "loading"
            ? [0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[88px] w-[180px] shrink-0" />
              ))
            : RECENT_PREDS.map((p) => <RecentPredCard key={p.id} p={p} />)}
        </div>
      </div>
    </div>
  );
}

function MobileDefault({ league }: { league: LeagueFilter }) {
  const filtered = filterFixturesByLeague(FIXTURES, league);
  return (
    <>
      <SectionLabel>Próximas 48h</SectionLabel>
      {filtered.length === 0 ? (
        <Card className="mx-5">
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="text-muted-fg-2">
              <Inbox className="size-9" strokeWidth={1.25} />
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium tracking-tight">
                Sem jogos para este filtro
              </span>
              <span className="max-w-[240px] text-[12.5px] text-muted-foreground tracking-tight">
                Tente outra liga ou volte mais tarde.
              </span>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mx-5 gap-0 overflow-hidden p-0">
          {filtered.map((m, i) => (
            <MatchRow key={m.id} m={m} last={i === filtered.length - 1} />
          ))}
        </Card>
      )}
    </>
  );
}

function MobileLoading() {
  return (
    <>
      <SectionLabel>Próximas 48h</SectionLabel>
      <Card className="mx-5 gap-0 overflow-hidden p-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <MatchRowSkeleton key={i} last={i === 4} />
        ))}
      </Card>
    </>
  );
}

function MobileEmpty() {
  return (
    <Card className="mx-5 mt-2">
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="text-muted-fg-2">
          <Inbox className="size-9" strokeWidth={1.25} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-medium tracking-tight">
            Sem jogos nas próximas 48h
          </span>
          <span className="max-w-[240px] text-[12.5px] text-muted-foreground tracking-tight">
            Brasileirão e Champions League sem partidas agendadas. Volte mais tarde ou ajuste o filtro.
          </span>
        </div>
      </div>
    </Card>
  );
}

function MobileError() {
  return (
    <Card className="mx-5 mt-2 border-warn-border bg-card">
      <div className="flex items-start gap-3 px-5 py-5">
        <span className="pt-0.5 text-warn-fg">
          <TriangleAlert className="size-4" />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[13.5px] font-medium tracking-tight">
              Falha ao carregar jogos
            </span>
            <span className="text-[12.5px] text-muted-foreground tracking-tight">
              The Odds API respondeu com erro 503. Pode ser instabilidade temporária.
            </span>
            <span className="pt-1 font-mono text-[10.5px] text-muted-fg-2">
              trace: fixtures.fetch:5xx · 14:22
            </span>
          </div>
          <div className="pt-1">
            <Button asChild size="sm" variant="secondary">
              <Link href="/">
                <RefreshCcw className="size-3.5" /> Tentar novamente
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DesktopHome({ preview, league }: { preview: PreviewState; league: LeagueFilter }) {
  const filtered = filterFixturesByLeague(FIXTURES, league);
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1040px] px-8 pt-10 pb-16">
        <div className="flex items-end justify-between pb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-medium leading-[1] tracking-[-0.035em]">
              Próximos jogos
            </h1>
            <p className="text-[13.5px] text-muted-foreground tracking-tight">
              {filtered.length} partidas nas próximas 48h · Brasileirão Série A + UEFA Champions League
            </p>
          </div>
          <LeagueTabs value={league} preserveState={preview} />
        </div>

        {preview === "loading" ? (
          <DesktopListLoading />
        ) : preview === "empty" ? (
          <DesktopEmpty />
        ) : preview === "error" ? (
          <DesktopError />
        ) : (
          <DesktopList fixtures={filtered} />
        )}

        <div className="pt-12">
          <div className="flex items-baseline justify-between pb-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
              suas predições recentes
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              5 / 5
            </span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {RECENT_PREDS.map((p) => (
              <RecentPredCard key={p.id} p={p} />
            ))}
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

function DesktopList({ fixtures }: { fixtures: Fixture[] }) {
  if (fixtures.length === 0) {
    return (
      <Card className="px-8 py-16 text-center">
        <div className="mx-auto flex max-w-[320px] flex-col items-center gap-3">
          <span className="text-muted-fg-2">
            <Inbox className="size-9" strokeWidth={1.25} />
          </span>
          <span className="text-[14px] font-medium tracking-tight">
            Sem jogos para este filtro
          </span>
          <span className="text-[12.5px] text-muted-foreground tracking-tight">
            Tente outra liga ou volte mais tarde.
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid grid-cols-[160px_1fr_160px_140px_40px] gap-4 border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>liga · kickoff</span>
        <span>jogo</span>
        <span className="text-right">odds</span>
        <span className="text-right">status</span>
        <span />
      </div>
      {fixtures.map((m, i) => (
        <Link
          key={m.id}
          href={`/match/${m.id}`}
          className={`grid grid-cols-[160px_1fr_160px_140px_40px] items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 ${
            i === fixtures.length - 1 ? "" : "border-b border-border-subtle"
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
            <span>
              <span className="text-muted-foreground">O</span> {m.odds.over}
            </span>
            <span>
              <span className="text-muted-foreground">U</span> {m.odds.under}
            </span>
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
  );
}

function DesktopListLoading() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`grid grid-cols-[160px_1fr_160px_140px_40px] items-center gap-4 px-5 py-4 ${
            i === 4 ? "" : "border-b border-border-subtle"
          }`}
        >
          <div className="flex flex-col gap-1">
            <Skeleton className="h-[18px] w-20" />
            <Skeleton className="h-[12px] w-24" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-[22px] rounded-full" />
              <Skeleton className="h-[14px] w-28" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-[22px] rounded-full" />
              <Skeleton className="h-[14px] w-32" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-[13px] w-14" />
            <Skeleton className="h-[13px] w-14" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-[18px] w-16" />
          </div>
          <span />
        </div>
      ))}
    </Card>
  );
}

function DesktopEmpty() {
  return (
    <Card className="px-8 py-16 text-center">
      <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3">
        <span className="text-muted-fg-2">
          <Inbox className="size-10" strokeWidth={1.25} />
        </span>
        <span className="text-[15px] font-medium tracking-tight">
          Sem jogos nas próximas 48h
        </span>
        <span className="text-[13px] text-muted-foreground tracking-tight">
          Brasileirão e Champions League sem partidas agendadas. Volte mais tarde ou ajuste o filtro.
        </span>
      </div>
    </Card>
  );
}

function DesktopError() {
  return (
    <Card className="border-warn-border">
      <div className="flex items-start gap-3 px-6 py-6">
        <span className="pt-0.5 text-warn-fg">
          <TriangleAlert className="size-4" />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium tracking-tight">
              Falha ao carregar jogos
            </span>
            <span className="text-[13px] text-muted-foreground tracking-tight">
              The Odds API respondeu com erro 503. Pode ser instabilidade temporária.
            </span>
            <span className="pt-1 font-mono text-[10.5px] text-muted-fg-2">
              trace: fixtures.fetch:5xx · 14:22
            </span>
          </div>
          <div className="pt-1">
            <Button asChild size="sm" variant="secondary">
              <Link href="/">
                <RefreshCcw className="size-3.5" /> Tentar novamente
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
