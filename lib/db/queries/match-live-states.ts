import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { matchLiveStates } from "@/db/schema";
import { db } from "@/lib/db";
import { IN_PLAY_FRESH_MS, LIVE_STATE_LEASE_MS } from "@/lib/live/freshness";

// Fronteira ÚNICA de `match_live_states` (#580, ADR 0060 §2): o cache entre instâncias do
// estado ao vivo, com o lease da busca na própria row (sem KV). Quem chama o provider é
// `lib/live/in-play-state.ts` (PR seguinte); aqui só leitura, lease e gravação.

export type MatchLiveState = typeof matchLiveStates.$inferSelect;

export async function getMatchLiveState(
  matchId: string
): Promise<MatchLiveState | null> {
  const rows = await db
    .select()
    .from(matchLiveStates)
    .where(eq(matchLiveStates.matchId, matchId))
    .limit(1);
  return rows[0] ?? null;
}

/** Leitura em lote para as listas (que nunca buscam no provider). */
export async function getMatchLiveStatesForMatches(
  matchIds: readonly string[]
): Promise<Map<string, MatchLiveState>> {
  const out = new Map<string, MatchLiveState>();
  if (matchIds.length === 0) return out;
  const rows = await db
    .select()
    .from(matchLiveStates)
    .where(inArray(matchLiveStates.matchId, [...new Set(matchIds)]));
  for (const row of rows) out.set(row.matchId, row);
  return out;
}

/**
 * Tenta pegar o lease da busca (§5.2 passo 3). `true` = esta instância busca; `false` =
 * a row está fresca ou outra instância está buscando (o chamador devolve a row como
 * está). Atômico no Postgres: um `UPDATE … RETURNING` condicional; na primeira vez (sem
 * row), um `INSERT … ON CONFLICT DO NOTHING RETURNING` faz o mesmo papel. `now` é
 * injetável para teste; os limiares saem dele, não do relógio do banco.
 */
export async function claimMatchLiveState(
  matchId: string,
  now: Date = new Date()
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - IN_PLAY_FRESH_MS);
  const leaseExpiredBefore = new Date(now.getTime() - LIVE_STATE_LEASE_MS);

  const claimed = await db
    .update(matchLiveStates)
    .set({ claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(matchLiveStates.matchId, matchId),
        or(
          isNull(matchLiveStates.fetchedAt),
          lt(matchLiveStates.fetchedAt, staleBefore)
        ),
        or(
          isNull(matchLiveStates.claimedAt),
          lt(matchLiveStates.claimedAt, leaseExpiredBefore)
        )
      )
    )
    .returning({ matchId: matchLiveStates.matchId });
  if (claimed.length > 0) return true;

  const inserted = await db
    .insert(matchLiveStates)
    .values({ matchId, claimedAt: now, updatedAt: now })
    .onConflictDoNothing({ target: matchLiveStates.matchId })
    .returning({ matchId: matchLiveStates.matchId });
  return inserted.length > 0;
}

export type SaveMatchLiveStateInput = {
  matchId: string;
  providerFixtureId: number | null;
  statusShort: string;
  elapsed: number | null;
  extra: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  // null = sem dado de expulsão (payload sem `events`).
  homeRed: number | null;
  awayRed: number | null;
  /** Instante da RESPOSTA do provider, não do upsert (§5.1). */
  fetchedAt: Date;
};

/**
 * Grava o estado buscado e solta o lease (`claimed_at = null`). Monotônico: uma resposta
 * mais velha que a gravada (duas instâncias depois de o lease vencer) não sobrescreve.
 */
export async function saveMatchLiveState(
  input: SaveMatchLiveStateInput
): Promise<void> {
  const values = {
    providerFixtureId: input.providerFixtureId,
    statusShort: input.statusShort,
    elapsed: input.elapsed,
    extra: input.extra,
    homeGoals: input.homeGoals,
    awayGoals: input.awayGoals,
    homeRed: input.homeRed,
    awayRed: input.awayRed,
    fetchedAt: input.fetchedAt,
    claimedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(matchLiveStates)
    .values({ matchId: input.matchId, ...values })
    .onConflictDoUpdate({
      target: matchLiveStates.matchId,
      // Um save sem o id resolvido não apaga o que já foi resolvido (custaria outra
      // busca por data na próxima vez).
      set: {
        ...values,
        providerFixtureId: sql`COALESCE(excluded.provider_fixture_id, ${matchLiveStates.providerFixtureId})`,
      },
      setWhere: sql`${matchLiveStates.fetchedAt} IS NULL OR ${matchLiveStates.fetchedAt} <= excluded.fetched_at`,
    });
}
