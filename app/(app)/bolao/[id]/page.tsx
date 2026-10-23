import type { Metadata } from "next";
import { IntentLink } from "@/components/intent-link";
import { notFound, redirect } from "next/navigation";
import { Trophy, X } from "lucide-react";
import { z } from "zod";

import { auth } from "@/auth";
import {
  closeFriendPoolBets,
  extendFriendPoolBets,
  removeFriendPool,
  removeFriendPoolEntry,
} from "@/app/actions/friend-pools";
import { AddEntryForm, ManualScoreForm, ReopenBetsForm } from "@/components/friend-pool-forms";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ResultBadge } from "@/components/result-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { getFriendPool, type FriendPoolDetail } from "@/lib/db/queries/friend-pools";
import { leagueToKey } from "@/lib/format";
import {
  getInPlayState,
  getInPlayStatesForMatches,
  type InPlayState,
} from "@/lib/live/in-play-state";
import { matchUnavailableReason } from "@/lib/live/phase";
import { MAX_ENTRIES_PER_POOL } from "@/lib/pools/pool-schema";
import {
  POOL_EXTEND_PRESETS_MIN,
  POOL_LIVE_CUTOFF_MINUTE,
  poolBetsOpen,
  poolClosedByOwner,
  poolEntriesRemovable,
  poolExtendable,
  poolLiveStateWanted,
  poolManualScoreAllowed,
  poolOpenUntilEnd,
  poolOwnerClosable,
  poolOwnerReopenable,
} from "@/lib/pools/pool-state";
import { computePoolOutcome, formatBrl, resolvePoolScore } from "@/lib/pools/winners";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  POOL_KIND_LABEL,
  POOL_MONEY_NOTE,
  POOL_RISK_NOTE,
  joinNames,
  poolBetShortLabel,
  poolBetsDeadlineLabel,
  poolEntryStampLabel,
  poolMatchLabel,
  poolWinnerStampLabel,
} from "@/lib/view/friend-pool";
import { displayMatchTeams, teamPair } from "@/lib/view/team";
import { RevisitRefresh } from "@/components/revisit-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bolão" };

// Um bolão (#567, ADR 0054): apostadores com a aposta ao lado, e no fim os ganhadores
// e a divisão do pote. Ganhadores saem em código do placar (lib/pools/winners.ts).

type PageProps = { params: Promise<{ id: string }> };

/**
 * Estado ao vivo do jogo do bolão (#580, PLAN-580 §10). Antes do apito, ou com a flag
 * desligada, nenhum. Depois, lê a row (sem buscar) e só chama `getInPlayState` (que
 * pode ir à API-Football, cache de 1 min) enquanto o bolão ainda pode estar aberto.
 * Falha não derruba a página: sem a busca, fica a row; sem row, as regras caem no relógio.
 */
async function poolInPlayState(
  detail: FriendPoolDetail,
  liveMode: boolean,
  now: Date,
): Promise<InPlayState | null> {
  const { pool, match } = detail;
  if (!liveMode || matchUnavailableReason(match.status, match.kickoffAt, now) === null) {
    return null;
  }
  let row: InPlayState | null;
  try {
    row = (await getInPlayStatesForMatches([match.id], { now })).get(match.id) ?? null;
  } catch {
    return null;
  }
  if (!poolLiveStateWanted(pool, match, row, now, { liveMode })) return row;
  try {
    return (await getInPlayState(match, { now })) ?? row;
  } catch {
    // A busca falhou: fica a row que já foi lida (as regras extrapolam a idade dela).
    return row;
  }
}

export default async function BolaoDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [detail, timeZone, liveMode] = await Promise.all([
    getFriendPool(id, session.user.id),
    getRequestTimeZone(),
    getEnableLiveMode(),
  ]);
  if (!detail) notFound();

  const { pool, match, entries } = detail;
  const now = new Date();
  const state = await poolInPlayState(detail, liveMode, now);
  const live = { liveMode };
  // Nomes curtos de exibição (#578). Os picks guardam chaves (home/draw/away), nunca o nome.
  const teams = displayMatchTeams(match.homeTeam, match.awayTeam, leagueToKey(match.league));
  // Siglas (desempatadas) pro placar na lista de apostadores (#577).
  const pair = teamPair(match.homeTeam, match.awayTeam, leagueToKey(match.league));
  const codes = { home: pair.home.short, away: pair.away.short };
  const open = poolBetsOpen(pool, match, state, now, live);
  // Tirar aposta: só antes do apito, mesmo com as apostas ainda abertas ao vivo.
  const removable = poolEntriesRemovable(match, now);
  const scoreAllowed = poolManualScoreAllowed(pool, match, state, now, live);
  const closedByOwner = poolClosedByOwner(pool, now);
  // Prazo das apostas abertas: "fecham aos 15'", "fecham em 8 min", "estendidas até 17:40".
  const deadline = open
    ? poolBetsDeadlineLabel(pool, match, now, { liveMode, state, timeZone })
    : undefined;
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
  const winnerEntries = outcome.settled ? entries.filter((e) => outcome.hitIds.has(e.id)) : [];
  const winners = winnerEntries.map((e) => e.bettorName);
  // Ganhadores que anotaram com o jogo rolando: o carimbo vai na linha do ganhador.
  const liveWinners = winnerEntries.flatMap((e) => {
    const label = poolWinnerStampLabel(e, match.kickoffAt);
    return label ? [{ id: e.id, name: e.bettorName, label }] : [];
  });
  // "Fechar apostas" (dono): só com o modo ao vivo; flag desligada = como antes.
  const canClose = poolOwnerClosable(pool, match, state, now, live);
  // "Reabrir apostas" (dono, #601), só com o modo ao vivo: antes do apito desfaz o
  // "fechar" dele; depois, com as apostas fechadas, sem resultado, jogo não terminado e
  // antes do apito + 3h, reabre até o fim do jogo.
  const canReopen = poolOwnerReopenable(pool, match, state, now, live);
  // Aberto até o fim do jogo (reaberto pelo dono, ou extensão no teto).
  const openUntilEnd = open && poolOpenUntilEnd(pool, match);
  // "Estender prazo" (ADR 0060 §7): admin, no próprio bolão (só o dono abre esta
  // página), depois do apito, sem resultado, jogo não terminado e antes do apito + 3h.
  // Aberto até o fim do jogo, um preset só encurtaria; com o "Reabrir apostas" na tela,
  // ele já reabre até o fim: nos dois casos o cartão some.
  const canExtend =
    session.user.role === "admin" &&
    !openUntilEnd &&
    !canReopen &&
    poolExtendable(pool, match, state, now, live);

  return (
    <div className="bg-background text-foreground">
      <RevisitRefresh />
      <PageContainer width="reading">
        <PageHeader
          back={{ href: "/bolao", label: "bolão" }}
          title={pool.title ?? `${teams.home} × ${teams.away}`}
          description={
            <>
              {poolMatchLabel(match, now, timeZone)} ·{" "}
              <IntentLink href={`/match/${match.id}`} className="underline underline-offset-2 hover:text-foreground">
                ver jogo
              </IntentLink>
            </>
          }
          meta={
            <>
              {entries.length} {entries.length === 1 ? "aposta" : "apostas"}
              {pool.entryAmountCents !== null &&
                ` · ${formatBrl(pool.entryAmountCents)} por pessoa · pote ${formatBrl(outcome.potCents ?? 0)}`}
              {deadline && <span className="text-warn-fg"> · apostas {deadline}</span>}
            </>
          }
        />

        {outcome.settled && (
          <Card className="mb-6 gap-2 px-5 py-5">
            <p className="text-muted-foreground text-meta uppercase tracking-label">
              resultado · {outcome.score.source === "manual" ? "placar lançado por você" : "placar do jogo"}
            </p>
            <p className="text-body font-medium tracking-tight">
              {teams.home} {outcome.score.home} × {outcome.score.away} {teams.away}
            </p>
            {winners.length > 0 ? (
              <>
                <p className="flex items-center gap-2 text-display-sm font-medium tracking-tight">
                  <Trophy className="size-5 shrink-0" aria-hidden />
                  {winners.length === 1 ? "Ganhou: " : "Ganharam: "}
                  {joinNames(winners)}
                </p>
                {liveWinners.length > 0 && (
                  <ul className="text-muted-foreground text-body-sm tabular-nums tracking-tight">
                    {liveWinners.map((w) => (
                      <li key={w.id}>
                        {w.name}: {w.label}
                      </li>
                    ))}
                  </ul>
                )}
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
                : `${closedByOwner ? "Você fechou as apostas." : "Apostas fechadas."} Quando o jogo acabar, o placar aparece aqui sozinho (a atualização roda a cada poucas horas)${scoreAllowed ? ", ou lance o placar abaixo" : ""}.`}
          </p>
        )}

        {!outcome.settled && openUntilEnd && (
          <p className="text-muted-foreground mb-6 text-body-sm tracking-tight">
            As apostas estão abertas até você fechar de novo ou o jogo acabar (no máximo
            até 3h depois do apito).
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
                const kindLabel = POOL_KIND_LABEL[e.kind] ?? e.kind;
                const bet = poolBetShortLabel(e.kind, e.params, teams, codes);
                const stamp = poolEntryStampLabel(e, match.kickoffAt);
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex min-w-16 flex-1 flex-col">
                      <span className="truncate text-body font-medium tracking-tight">
                        {e.bettorName}
                      </span>
                      {/* Anotada com o jogo rolando (#580): minuto e placar da hora. */}
                      {stamp && (
                        <span className="text-muted-foreground truncate text-meta tabular-nums">
                          {stamp}
                        </span>
                      )}
                    </span>
                    {/* Tipo e aposta numa linha só (#577): o placar vai com as siglas. */}
                    <span
                      className="min-w-0 truncate text-right text-body-sm tabular-nums tracking-tight"
                      title={`${kindLabel} · ${bet}`}
                    >
                      <span className="text-muted-foreground text-meta">{kindLabel} · </span>
                      {bet}
                    </span>
                    {hit !== null && <ResultBadge result={hit ? "won" : "lost"} />}
                    {removable && (
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
            {liveMode && (
              <p className="text-muted-foreground text-body-sm tracking-tight">
                {removable
                  ? `Depois do apito ainda dá pra anotar até os ${POOL_LIVE_CUTOFF_MINUTE} minutos de jogo, mas tirar aposta, só até o apito.`
                  : "Com o jogo rolando, cada aposta fica com o minuto e o placar da hora em que foi anotada."}
              </p>
            )}
            <AddEntryForm poolId={pool.id} homeTeam={teams.home} awayTeam={teams.away} />
          </Card>
        )}

        {canClose && (
          <details className="mb-8">
            <summary className="text-muted-foreground cursor-pointer text-meta uppercase tracking-label hover:text-foreground">
              fechar apostas
            </summary>
            <form action={closeFriendPoolBets} className="flex flex-col gap-2 pt-3">
              <input type="hidden" name="poolId" value={pool.id} />
              <p className="text-body-sm tracking-tight">
                Fecha as apostas agora: ninguém mais entra no bolão. Dá pra reabrir enquanto o
                jogo não acabar.
              </p>
              <Button type="submit" variant="outline" size="sm" className="w-fit">
                Fechar apostas
              </Button>
            </form>
          </details>
        )}

        {canReopen && (
          <ReopenBetsForm
            poolId={pool.id}
            note={
              removable
                ? `Reabre as apostas agora: volta o prazo de sempre, até os ${POOL_LIVE_CUTOFF_MINUTE} minutos de jogo.`
                : "Reabre as apostas agora: elas ficam abertas até você fechar de novo ou o jogo acabar. Cada aposta nova fica com o minuto e o placar da hora."
            }
          />
        )}

        {canExtend && (
          <Card className="mb-8 gap-3 px-5 py-5">
            <h2 className="text-body font-medium tracking-tight">Estender prazo</h2>
            <p className="text-muted-foreground text-body-sm tracking-tight">
              Deixa anotar aposta por mais um tempo a partir de agora, até 3h depois do
              apito. Vale também se as apostas já fecharam.
            </p>
            <div className="flex flex-wrap gap-2">
              {POOL_EXTEND_PRESETS_MIN.map((minutes) => (
                <form key={minutes} action={extendFriendPoolBets}>
                  <input type="hidden" name="poolId" value={pool.id} />
                  <input type="hidden" name="minutes" value={minutes} />
                  <Button type="submit" variant="outline" size="sm" className="tabular-nums">
                    +{minutes} min
                  </Button>
                </form>
              ))}
            </div>
          </Card>
        )}

        {scoreAllowed && match.status !== "cancelled" && (
          <Card className="mb-8 gap-3 px-5 py-5">
            <h2 className="text-body font-medium tracking-tight">Placar final</h2>
            <p className="text-muted-foreground text-body-sm tracking-tight">
              Digite o placar se o jogo ainda não atualizou, ou se vocês combinaram outro
              (o placar do jogo inclui a prorrogação, quando tem).
            </p>
            <ManualScoreForm
              poolId={pool.id}
              homeTeam={teams.home}
              awayTeam={teams.away}
              manual={manual}
            />
          </Card>
        )}

        <details className="mb-8">
          <summary className="text-muted-foreground cursor-pointer text-meta uppercase tracking-label hover:text-foreground">
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
