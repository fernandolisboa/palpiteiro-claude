import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { NewPoolForm } from "@/components/friend-pool-forms";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { listFriendPools, type FriendPoolListRow } from "@/lib/db/queries/friend-pools";
import { getActiveLeaguesForRequest } from "@/lib/db/queries/league-settings";
import { getMatchesInRange } from "@/lib/db/queries/matches";
import { leagueToKey } from "@/lib/format";
import {
  IN_PLAY_WINDOW_AFTER_MS,
  getInPlayStatesForMatches,
  type InPlayState,
} from "@/lib/live/in-play-state";
import { poolWindowOpen } from "@/lib/pools/pool-state";
import { poolPotCents, formatBrl } from "@/lib/pools/winners";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  POOL_MONEY_NOTE,
  POOL_RISK_NOTE,
  poolMatchLabel,
  poolPickerLabel,
  poolStatusView,
  type PoolStatusTone,
} from "@/lib/view/friend-pool";
import { cn } from "@/lib/utils";
import { displayMatchTeams } from "@/lib/view/team";

export const dynamic = "force-dynamic";

// Bolão entre amigos (#567, ADR 0054): lista dos bolões do usuário + criar um novo.
// Privado: userId sempre do auth().

const PICKER_DAYS = 14;
const PICKER_LIMIT = 300;

type PageProps = { searchParams: Promise<{ jogo?: string }> };

export default async function BolaoPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;

  const { jogo } = await searchParams;
  const now = new Date();
  const [leagues, liveMode] = await Promise.all([
    getActiveLeaguesForRequest(),
    getEnableLiveMode(),
  ]);
  const [pools, upcoming, timeZone] = await Promise.all([
    listFriendPools(userId),
    // Modo ao vivo (#580): desde 4h atrás (a janela do estado ao vivo); os jogos já
    // apitados só entram no seletor se ainda estão na janela do bolão (filtro abaixo).
    // Flag desligada: como antes, só os jogos agendados daqui pra frente.
    getMatchesInRange({
      from: liveMode ? new Date(now.getTime() - IN_PLAY_WINDOW_AFTER_MS) : now,
      to: new Date(now.getTime() + PICKER_DAYS * 24 * 60 * 60 * 1000),
      leagues,
      statuses: liveMode ? ["scheduled", "live"] : ["scheduled"],
      order: "asc",
      limit: PICKER_LIMIT,
    }),
    getRequestTimeZone(),
  ]);
  // Estado ao vivo dos jogos apitados (#580): só as rows, nunca busca no provider.
  const liveIds = liveMode
    ? [...pools.map((r) => r.match), ...upcoming]
        .filter((m) => isInLiveWindow(m.kickoffAt, now))
        .map((m) => m.id)
    : [];
  const liveStates =
    liveIds.length > 0
      ? await getInPlayStatesForMatches([...new Set(liveIds)], { now }).catch(
          () => new Map<string, InPlayState>(),
        )
      : new Map<string, InPlayState>();

  // Antes do apito, todo jogo; depois, só os que ainda aceitam bolão (até 15' de jogo,
  // ou apito + 15 min pelo relógio sem a row). Flag desligada: só os de antes do apito.
  const options = upcoming
    .filter((m) => poolWindowOpen(m, liveStates.get(m.id) ?? null, now, { liveMode }))
    .map((m) => ({ id: m.id, label: poolPickerLabel(m, now, timeZone) }));
  const defaultMatchId = options.some((o) => o.id === jogo) ? (jogo ?? null) : null;

  return (
    <div className="bg-background text-foreground">
      <PageContainer width="reading">
        <PageHeader title="Bolão" description="bolão entre amigos · cada um com seu palpite" />

        <Card className="mb-8 gap-4 px-5 py-5">
          <h2 className="text-body font-medium tracking-tight">Novo bolão</h2>
          <NewPoolForm options={options} defaultMatchId={defaultMatchId} />
        </Card>

        <h2 className="pb-3 text-body font-medium tracking-tight">Seus bolões</h2>
        {pools.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="Nenhum bolão ainda"
            description={
              options.length > 0
                ? "Escolha um jogo acima, crie o bolão e anote a aposta de cada amigo."
                : `Quando houver jogo nos próximos ${PICKER_DAYS} dias, crie o bolão aqui em cima e anote a aposta de cada amigo.`
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {pools.map((row) => (
              <li key={row.pool.id}>
                <PoolRow
                  row={row}
                  now={now}
                  timeZone={timeZone}
                  liveMode={liveMode}
                  state={liveStates.get(row.match.id) ?? null}
                />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-meta leading-relaxed text-muted-foreground tracking-tight">
          {POOL_MONEY_NOTE} {POOL_RISK_NOTE}
        </p>
      </PageContainer>
    </div>
  );
}

// Aberto em destaque (DESIGN.md), âmbar nas últimas 3h antes da trava, o resto em
// contorno neutro (#577).
const STATUS_TONE: Record<PoolStatusTone, string> = {
  open: "border-accent-border bg-accent-soft text-accent-fg",
  soon: "border-warn-border bg-warn-soft text-warn-fg",
  neutral: "border-border bg-transparent text-muted-foreground",
};

/** Apito já passou e o jogo ainda pode ter estado ao vivo (a janela de busca, 4h). */
function isInLiveWindow(kickoffAt: Date, now: Date): boolean {
  const t = now.getTime() - kickoffAt.getTime();
  return t >= 0 && t <= IN_PLAY_WINDOW_AFTER_MS;
}

function PoolRow({
  row,
  now,
  timeZone,
  liveMode,
  state,
}: {
  row: FriendPoolListRow;
  now: Date;
  timeZone: string | undefined;
  liveMode: boolean;
  state: InPlayState | null;
}) {
  const status = poolStatusView(row, now, { liveMode, state, timeZone });
  const pot = poolPotCents(row.pool.entryAmountCents, row.entryCount);
  const teams = displayMatchTeams(
    row.match.homeTeam,
    row.match.awayTeam,
    leagueToKey(row.match.league),
  );
  const title = row.pool.title ?? `${teams.home} × ${teams.away}`;
  return (
    <Link
      href={`/bolao/${row.pool.id}`}
      className="block rounded-xl border border-border px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-body font-medium tracking-tight">{title}</p>
          <p className="text-muted-foreground text-meta">
            {poolMatchLabel(row.match, now, timeZone)}
          </p>
          <p className="text-muted-foreground pt-1 text-meta tabular-nums">
            {row.entryCount} {row.entryCount === 1 ? "aposta" : "apostas"}
            {pot !== null && pot > 0 ? ` · pote ${formatBrl(pot)}` : ""}
          </p>
        </div>
        <Badge
          variant="outline"
          size="sm"
          className={cn("shrink-0 tabular-nums tracking-tight", STATUS_TONE[status.tone])}
        >
          {status.label}
        </Badge>
      </div>
    </Link>
  );
}
