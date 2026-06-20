import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { Card } from "@/components/ui/card";
import { DesktopShell } from "@/components/desktop-shell";
import { EmptyState } from "@/components/empty-state";
import { MatchRow } from "@/components/match-row";
import { SectionLabel } from "@/components/section-label";
import { ThemeToggle } from "@/components/theme-toggle";
import { auth } from "@/auth";
import { getMatchesByTeam, type DbMatch } from "@/lib/db/queries/matches";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { leagueToKey } from "@/lib/format";
import { displayTeamName } from "@/lib/view/team-labels";
import { toMatchRowView } from "@/lib/view/match";
import type { MatchRowView } from "@/lib/view/types";

// Render dinâmico explícito: lê o cookie de fuso (#1) por-request via
// getRequestTimeZone() e a sessão. auth() já a tornava dinâmica; o explícito
// blinda a correção de fuso de um eventual passe estático.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ team: string }>;
};

export default async function TeamHistoryPage({ params }: PageProps) {
  const { team } = await params;
  // Route key = nome CANÔNICO do time, URL-encoded (não slug, não id — #407).
  // Round-trip lossless: o canonical tem espaços/acentos/barras.
  const canonical = decodeURIComponent(team);

  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Fuso de exibição do usuário (#1) — threadado em TODA chamada de
  // toMatchRowView; omitir reverteria pra UTC (o bug exato do #409/#410).
  const timeZone = await getRequestTimeZone();
  // Instante único do request pras DUAS fatias (kickoff relativo/countdown).
  const now = new Date();

  const { past, future } = await getMatchesByTeam(canonical);

  // Time só existe em liga inativa (ou nome inválido) → nenhuma das fatias.
  if (past.length === 0 && future.length === 0) notFound();

  // Nome de exibição (PT-BR p/ Copa) derivado da liga de qualquer jogo — a
  // identidade da rota continua keada no canonical cru. Display/identity split.
  const sampleLeague = (future[0] ?? past[0])!.league;
  const displayName = displayTeamName(canonical, leagueToKey(sampleLeague));

  // Href DESTA página, pro back-param dos jogos (#405/#406): abrir um jogo e
  // voltar retorna ao histórico do time (resolveBackHref aceita a base /time).
  const teamHref = `/time/${encodeURIComponent(canonical)}`;

  const toRow = (m: DbMatch): MatchRowView =>
    toMatchRowView({
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
      odds: null,
      hasPrediction: false,
      now,
      timeZone,
    });

  const futureRows = future.map(toRow);
  const pastRows = past.map(toRow);

  return (
    <>
      <div className="lg:hidden">
        <MobileTeam
          displayName={displayName}
          futureRows={futureRows}
          pastRows={pastRows}
          teamHref={teamHref}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopTeam
          displayName={displayName}
          futureRows={futureRows}
          pastRows={pastRows}
          teamHref={teamHref}
        />
      </div>
    </>
  );
}

type ViewProps = {
  displayName: string;
  futureRows: MatchRowView[];
  pastRows: MatchRowView[];
  teamHref: string;
};

function MatchList({
  rows,
  teamHref,
  emptyTitle,
}: {
  rows: MatchRowView[];
  teamHref: string;
  emptyTitle: string;
}) {
  if (rows.length === 0) {
    return <EmptyState className="py-8" title={emptyTitle} />;
  }
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {rows.map((m, i, arr) => (
        <MatchRow
          key={m.id}
          m={m}
          last={i === arr.length - 1}
          backHref={teamHref}
        />
      ))}
    </Card>
  );
}

function MobileTeam({
  displayName,
  futureRows,
  pastRows,
  teamHref,
}: ViewProps) {
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
        <ThemeToggle />
      </header>

      <div className="px-5 pt-3 pb-2">
        <h1 className="text-display-sm font-medium tracking-tight">
          {displayName}
        </h1>
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          histórico do time
        </span>
      </div>

      <div className="flex flex-col gap-2 pb-8">
        <SectionLabel>próximos jogos</SectionLabel>
        <div className="px-5">
          <MatchList
            rows={futureRows}
            teamHref={teamHref}
            emptyTitle="Sem jogos agendados."
          />
        </div>
        <div className="pt-3">
          <SectionLabel>últimos resultados</SectionLabel>
        </div>
        <div className="px-5">
          <MatchList
            rows={pastRows}
            teamHref={teamHref}
            emptyTitle="Sem resultados recentes."
          />
        </div>
      </div>
    </div>
  );
}

function DesktopTeam({
  displayName,
  futureRows,
  pastRows,
  teamHref,
}: ViewProps) {
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

        <div className="pb-6">
          <h1 className="text-display-md font-medium tracking-tight">
            {displayName}
          </h1>
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            histórico do time
          </span>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <section className="flex flex-col gap-2">
            <SectionLabel>próximos jogos</SectionLabel>
            <MatchList
              rows={futureRows}
              teamHref={teamHref}
              emptyTitle="Sem jogos agendados."
            />
          </section>
          <section className="flex flex-col gap-2">
            <SectionLabel>últimos resultados</SectionLabel>
            <MatchList
              rows={pastRows}
              teamHref={teamHref}
              emptyTitle="Sem resultados recentes."
            />
          </section>
        </div>
      </div>
    </DesktopShell>
  );
}
