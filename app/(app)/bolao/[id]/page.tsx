import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, Trophy, X } from "lucide-react";
import { z } from "zod";

import { auth } from "@/auth";
import { removeFriendPool, removeFriendPoolEntry } from "@/app/actions/friend-pools";
import { AddEntryForm, ManualScoreForm } from "@/components/friend-pool-forms";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getFriendPool } from "@/lib/db/queries/friend-pools";
import { MAX_ENTRIES_PER_POOL } from "@/lib/pools/pool-schema";
import { poolBetsOpen } from "@/lib/pools/pool-state";
import { computePoolOutcome, formatBrl, resolvePoolScore } from "@/lib/pools/winners";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  POOL_KIND_LABEL,
  POOL_MONEY_NOTE,
  POOL_RISK_NOTE,
  joinNames,
  poolBetLabel,
  poolMatchLabel,
} from "@/lib/view/friend-pool";

export const dynamic = "force-dynamic";

// Um bolão (#567, ADR 0054): apostadores com a aposta ao lado, e no fim os ganhadores
// e a divisão do pote. Ganhadores saem em código do placar (lib/pools/winners.ts).

type PageProps = { params: Promise<{ id: string }> };

export default async function BolaoDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [detail, timeZone] = await Promise.all([
    getFriendPool(id, session.user.id),
    getRequestTimeZone(),
  ]);
  if (!detail) notFound();

  const { pool, match, entries } = detail;
  const now = new Date();
  const teams = { home: match.homeTeam, away: match.awayTeam };
  const open = poolBetsOpen(match, now);
  const score = resolvePoolScore(pool, match);
  const outcome = computePoolOutcome({
    entries,
    entryAmountCents: pool.entryAmountCents,
    score,
  });
  const manual =
    pool.manualHomeScore !== null && pool.manualAwayScore !== null
      ? { home: pool.manualHomeScore, away: pool.manualAwayScore }
      : null;
  const winners = outcome.settled
    ? entries.filter((e) => outcome.hitIds.has(e.id)).map((e) => e.bettorName)
    : [];

  return (
    <div className="bg-background text-foreground">
      <PageContainer width="reading">
        <PageHeader
          back={{ href: "/bolao", label: "bolão" }}
          title={pool.title ?? `${match.homeTeam} × ${match.awayTeam}`}
          description={
            <>
              {poolMatchLabel(match, now, timeZone)} ·{" "}
              <Link href={`/match/${match.id}`} className="underline underline-offset-2 hover:text-foreground">
                ver jogo
              </Link>
            </>
          }
          meta={
            <>
              {entries.length} {entries.length === 1 ? "aposta" : "apostas"}
              {pool.entryAmountCents !== null &&
                ` · ${formatBrl(pool.entryAmountCents)} por pessoa · pote ${formatBrl(outcome.potCents ?? 0)}`}
            </>
          }
        />

        {outcome.settled && (
          <Card className="mb-6 gap-2 px-5 py-5">
            <p className="text-muted-foreground font-mono text-meta uppercase tracking-label">
              resultado · {outcome.score.source === "manual" ? "placar lançado por você" : "placar do jogo"}
            </p>
            <p className="text-body font-medium tracking-tight">
              {match.homeTeam} {outcome.score.home} × {outcome.score.away} {match.awayTeam}
            </p>
            {winners.length > 0 ? (
              <>
                <p className="flex items-center gap-2 text-display-sm font-medium tracking-tight">
                  <Trophy className="size-5 shrink-0" aria-hidden />
                  {winners.length === 1 ? "Ganhou: " : "Ganharam: "}
                  {joinNames(winners)}
                </p>
                {outcome.shareCents !== null && (
                  <p className="text-body-sm tracking-tight">
                    Pote de {formatBrl(outcome.potCents ?? 0)}:{" "}
                    {winners.length === 1
                      ? `leva ${formatBrl(outcome.shareCents)}.`
                      : `cada um leva ${formatBrl(outcome.shareCents)}.`}
                    {outcome.remainderCents ? ` Sobra ${formatBrl(outcome.remainderCents)} da divisão.` : ""}
                  </p>
                )}
              </>
            ) : (
              <p className="text-body tracking-tight">
                Ninguém acertou.
                {outcome.potCents ? ` O pote de ${formatBrl(outcome.potCents)} fica pra vocês decidirem.` : ""}
              </p>
            )}
          </Card>
        )}

        {!outcome.settled && !open && (
          <p className="text-muted-foreground mb-6 text-body-sm tracking-tight">
            {match.status === "postponed"
              ? "Jogo adiado. As apostas ficam guardadas; quando ele for jogado, lance o placar aqui."
              : match.status === "cancelled"
                ? "Jogo cancelado. Não há resultado pra conferir."
                : "Apostas fechadas. Quando o jogo acabar, o placar aparece aqui sozinho (a atualização roda a cada poucas horas), ou lance o placar abaixo."}
          </p>
        )}

        <section aria-labelledby="apostadores" className="mb-8">
          <h2 id="apostadores" className="pb-3 text-body font-medium tracking-tight">
            Apostadores
          </h2>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-body-sm">
              {open ? "Ninguém apostou ainda. Anote a aposta de cada um abaixo." : "Ninguém apostou neste bolão."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {entries.map((e) => {
                const hit = outcome.settled ? outcome.hitIds.has(e.id) : null;
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-5 shrink-0">
                      {hit === true && (
                        <>
                          <Check className="size-4 text-accent-fg" aria-hidden />
                          <span className="sr-only">acertou</span>
                        </>
                      )}
                      {hit === false && (
                        <>
                          <X className="size-4 text-muted-fg-2" aria-hidden />
                          <span className="sr-only">errou</span>
                        </>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body font-medium tracking-tight">
                      {e.bettorName}
                    </span>
                    <span className="min-w-0 flex-[2] text-right text-body-sm tracking-tight">
                      <span className="text-muted-foreground font-mono text-meta">
                        {POOL_KIND_LABEL[e.kind] ?? e.kind} ·{" "}
                      </span>
                      {poolBetLabel(e.kind, e.params, teams)}
                    </span>
                    {open && (
                      <form action={removeFriendPoolEntry}>
                        <input type="hidden" name="poolId" value={pool.id} />
                        <input type="hidden" name="entryId" value={e.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          aria-label={`Tirar a aposta de ${e.bettorName}`}
                          className="text-muted-fg-2"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {open && entries.length < MAX_ENTRIES_PER_POOL && (
          <Card className="mb-8 gap-4 px-5 py-5">
            <h2 className="text-body font-medium tracking-tight">Anotar aposta</h2>
            <AddEntryForm poolId={pool.id} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />
          </Card>
        )}

        {!open && match.status !== "cancelled" && (
          <Card className="mb-8 gap-3 px-5 py-5">
            <h2 className="text-body font-medium tracking-tight">Placar final</h2>
            <p className="text-muted-foreground text-body-sm tracking-tight">
              Digite o placar se o jogo ainda não atualizou, ou se vocês combinaram outro
              (o placar do jogo inclui a prorrogação, quando tem).
            </p>
            <ManualScoreForm
              poolId={pool.id}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              manual={manual}
            />
          </Card>
        )}

        <details className="mb-8">
          <summary className="text-muted-foreground cursor-pointer font-mono text-meta uppercase tracking-label hover:text-foreground">
            excluir bolão
          </summary>
          <form action={removeFriendPool} className="flex flex-col gap-2 pt-3">
            <input type="hidden" name="poolId" value={pool.id} />
            <p className="text-body-sm tracking-tight">
              Apaga o bolão e todas as apostas dele. Não dá pra desfazer.
            </p>
            <Button type="submit" variant="destructive" size="sm" className="w-fit">
              Excluir bolão
            </Button>
          </form>
        </details>

        <p className="text-meta leading-relaxed text-muted-foreground tracking-tight">
          {POOL_MONEY_NOTE} {POOL_RISK_NOTE}
        </p>
      </PageContainer>
    </div>
  );
}
