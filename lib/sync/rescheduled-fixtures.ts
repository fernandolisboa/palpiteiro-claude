import {
  getReschedulableMatches,
  markMatchesSuperseded,
  rekeyMatch,
  type DbMatch,
} from "@/lib/db/queries/matches";
import {
  compositeFixtureKey,
  type NormalizedFixture,
} from "@/lib/providers/sports-data/types";

// Jogo remarcado. O `external_id` inclui o kickoff (compositeFixtureKey), então quando o
// provider muda o horário o upsert criava OUTRA row e a antiga ficava `scheduled` com o
// horário velho: virava "ao vivo" no horário antigo, sem placar (o provider não tem jogo
// ali), com o palpite travado (Bahia x São Paulo, 2026-10-28, 18h → 21h30). Aqui, antes
// do upsert, a row antiga recebe a chave e o horário novos e segue sendo o mesmo jogo
// (análises, apostas e bolão junto). Se a row nova já existe (sync de antes desta
// correção), a antiga vira `postponed`: sai do "ao vivo" e não aceita análise.

// Mesmo confronto (mandante e visitante) dentro desta distância é o mesmo jogo
// remarcado. Numa liga o mesmo mando se repete no máximo uma vez por temporada; nas
// copas, ida e volta invertem o mando.
export const RESCHEDULE_MAX_SHIFT_MS = 60 * 24 * 60 * 60_000;

// Rows antigas que ainda podem estar presas: kickoff até este tanto antes de agora.
export const RESCHEDULE_LOOKBACK_MS = RESCHEDULE_MAX_SHIFT_MS;

// Só o que ainda não terminou pode ter sido remarcado.
const OPEN_STATUSES: ReadonlySet<DbMatch["status"]> = new Set([
  "scheduled",
  "live",
  "postponed",
]);

export type RescheduleRow = Pick<
  DbMatch,
  "id" | "externalId" | "league" | "homeTeam" | "awayTeam" | "kickoffAt" | "status"
>;

export type ReschedulePlan = {
  rekey: { id: string; fromKey: string; externalId: string; kickoffAt: Date }[];
  supersede: { id: string; externalId: string }[];
};

function pairKey(x: { league: string; homeTeam: string; awayTeam: string }): string {
  return `${x.league}:${x.homeTeam}:${x.awayTeam}`;
}

/**
 * Puro. `fixtures` é a temporada inteira das ligas que o provider respondeu nesta
 * rodada; `rows`, as rows dessas ligas a partir do lookback. Uma row aberta cuja chave
 * sumiu do provider e cujo confronto aparece lá com outro horário (o mais próximo, até
 * RESCHEDULE_MAX_SHIFT_MS) foi remarcada: a mais próxima do horário novo herda a chave
 * (se ninguém a tem ainda); as outras são superadas. Sem par no provider, nada muda
 * (pode ser só um buraco do provider).
 */
export function planRescheduledFixtures(
  rows: readonly RescheduleRow[],
  fixtures: readonly NormalizedFixture[],
): ReschedulePlan {
  const providerKeys = new Set(fixtures.map((f) => compositeFixtureKey(f)));
  const dbKeys = new Set(rows.map((r) => r.externalId));
  const fixturesByPair = new Map<string, NormalizedFixture[]>();
  for (const f of fixtures) {
    const k = pairKey(f);
    fixturesByPair.set(k, [...(fixturesByPair.get(k) ?? []), f]);
  }

  // Chave nova → rows órfãs que apontam pra ela, com a distância.
  const orphansByTarget = new Map<
    string,
    { target: NormalizedFixture; orphans: { row: RescheduleRow; shift: number }[] }
  >();
  for (const row of rows) {
    if (!OPEN_STATUSES.has(row.status) || providerKeys.has(row.externalId)) continue;
    let best: { f: NormalizedFixture; shift: number } | null = null;
    for (const f of fixturesByPair.get(pairKey(row)) ?? []) {
      const shift = Math.abs(f.kickoffTimestampMs - row.kickoffAt.getTime());
      if (shift > RESCHEDULE_MAX_SHIFT_MS) continue;
      if (best === null || shift < best.shift) best = { f, shift };
    }
    if (best === null) continue;
    const key = compositeFixtureKey(best.f);
    const entry = orphansByTarget.get(key) ?? { target: best.f, orphans: [] };
    entry.orphans.push({ row, shift: best.shift });
    orphansByTarget.set(key, entry);
  }

  const plan: ReschedulePlan = { rekey: [], supersede: [] };
  for (const [key, { target, orphans }] of orphansByTarget) {
    orphans.sort((a, b) => a.shift - b.shift || a.row.id.localeCompare(b.row.id));
    const rest = dbKeys.has(key) ? orphans : orphans.slice(1);
    if (!dbKeys.has(key)) {
      const { row } = orphans[0];
      plan.rekey.push({
        id: row.id,
        fromKey: row.externalId,
        externalId: key,
        kickoffAt: new Date(target.kickoffTimestampMs),
      });
    }
    for (const { row } of rest) {
      if (row.status !== "postponed") {
        plan.supersede.push({ id: row.id, externalId: row.externalId });
      }
    }
  }
  return plan;
}

/**
 * Aplica o plano antes do upsert do sync. Cada passo é um UPDATE idempotente (o driver
 * HTTP do Neon não tem transação interativa): uma falha no meio deixa o resto pra
 * próxima rodada, que replaneja do zero.
 */
export async function reconcileRescheduledFixtures(
  fixtures: readonly NormalizedFixture[],
  now: Date = new Date(),
): Promise<ReschedulePlan> {
  const leagues = [...new Set(fixtures.map((f) => f.league))];
  if (leagues.length === 0) return { rekey: [], supersede: [] };
  const rows = await getReschedulableMatches({
    leagues,
    since: new Date(now.getTime() - RESCHEDULE_LOOKBACK_MS),
  });
  const plan = planRescheduledFixtures(rows, fixtures);
  for (const r of plan.rekey) {
    await rekeyMatch(r);
    console.info(
      JSON.stringify({
        scope: "sync-upcoming-fixtures",
        event: "match_rescheduled",
        matchId: r.id,
        from: r.fromKey,
        to: r.externalId,
      }),
    );
  }
  if (plan.supersede.length > 0) {
    await markMatchesSuperseded(plan.supersede.map((s) => s.id));
    console.info(
      JSON.stringify({
        scope: "sync-upcoming-fixtures",
        event: "match_superseded",
        externalIds: plan.supersede.map((s) => s.externalId),
      }),
    );
  }
  return plan;
}
