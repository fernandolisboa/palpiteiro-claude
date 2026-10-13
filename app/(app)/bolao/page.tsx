import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { NewPoolForm } from "@/components/friend-pool-forms";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listFriendPools, type FriendPoolListRow } from "@/lib/db/queries/friend-pools";
import { getActiveLeaguesForRequest } from "@/lib/db/queries/league-settings";
import { getMatchesInRange } from "@/lib/db/queries/matches";
import { poolPotCents, formatBrl, resolvePoolScore } from "@/lib/pools/winners";
import { poolBetsOpen } from "@/lib/pools/pool-state";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { POOL_MONEY_NOTE, POOL_RISK_NOTE, poolMatchLabel } from "@/lib/view/friend-pool";

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
  const leagues = await getActiveLeaguesForRequest();
  const [pools, upcoming, timeZone] = await Promise.all([
    listFriendPools(userId),
    getMatchesInRange({
      from: now,
      to: new Date(now.getTime() + PICKER_DAYS * 24 * 60 * 60 * 1000),
      leagues,
      statuses: ["scheduled"],
      order: "asc",
      limit: PICKER_LIMIT,
    }),
    getRequestTimeZone(),
  ]);

  const options = upcoming.map((m) => ({ id: m.id, label: poolMatchLabel(m, now, timeZone) }));
  const defaultMatchId = options.some((o) => o.id === jogo) ? (jogo ?? null) : null;

  return (
    <div className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <h1 className="text-display-md font-medium tracking-tight">Bolão</h1>
        <p className="text-muted-foreground pb-6 font-mono text-meta">
          bolão entre amigos · cada um com seu palpite
        </p>

        <Card className="mb-8 gap-4 px-5 py-5">
          <h2 className="text-body font-medium tracking-tight">Novo bolão</h2>
          <NewPoolForm options={options} defaultMatchId={defaultMatchId} />
        </Card>

        <h2 className="pb-3 text-body font-medium tracking-tight">Seus bolões</h2>
        {pools.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="Nenhum bolão ainda"
            description="Escolha um jogo acima, crie o bolão e anote a aposta de cada amigo."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {pools.map((row) => (
              <li key={row.pool.id}>
                <PoolRow row={row} now={now} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
          {POOL_MONEY_NOTE} {POOL_RISK_NOTE}
        </p>
      </div>
    </div>
  );
}

function statusOf(row: FriendPoolListRow, now: Date): { label: string; tone: "default" | "secondary" | "outline" } {
  const score = resolvePoolScore(row.pool, row.match);
  if (score) return { label: `placar ${score.home} × ${score.away}`, tone: "default" };
  if (row.match.status === "postponed") return { label: "jogo adiado", tone: "outline" };
  if (row.match.status === "cancelled") return { label: "jogo cancelado", tone: "outline" };
  if (poolBetsOpen(row.match, now)) return { label: "apostas abertas", tone: "secondary" };
  return { label: "esperando o placar", tone: "outline" };
}

function PoolRow({
  row,
  now,
  timeZone,
}: {
  row: FriendPoolListRow;
  now: Date;
  timeZone: string | undefined;
}) {
  const status = statusOf(row, now);
  const pot = poolPotCents(row.pool.entryAmountCents, row.entryCount);
  const title = row.pool.title ?? `${row.match.homeTeam} × ${row.match.awayTeam}`;
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
          <p className="text-muted-fg-2 pt-1 font-mono text-meta">
            {row.entryCount} {row.entryCount === 1 ? "aposta" : "apostas"}
            {pot !== null && pot > 0 ? ` · pote ${formatBrl(pot)}` : ""}
          </p>
        </div>
        <Badge variant={status.tone} className="shrink-0">
          {status.label}
        </Badge>
      </div>
    </Link>
  );
}
