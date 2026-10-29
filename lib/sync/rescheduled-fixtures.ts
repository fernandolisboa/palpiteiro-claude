import {
  getReschedulableMatches,
  markMatchesSuperseded,
  rekeyMatch,
  SUPERSEDED_KEY_PREFIX,
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
// (análises, apostas e bolão junto). A cópia que sobra é aposentada: `postponed` e fora
// das listas.

// Mesmo confronto (mandante e visitante) dentro desta distância é o mesmo jogo
// remarcado. Numa liga o mesmo mando se repete no máximo uma vez por temporada; nas
// copas, ida e volta invertem o mando.
export const RESCHEDULE_MAX_SHIFT_MS = 60 * 24 * 60 * 60_000;

// Rows antigas que ainda podem estar presas: kickoff até este tanto antes de agora. As
// rows lidas vão um RESCHEDULE_MAX_SHIFT_MS além disso, pra toda chave nova possível de
// uma row candidata estar no conjunto (senão o rekey bateria no unique de external_id).
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
> & { hasUserData: boolean };

export type ReschedulePlan = {
  // Aplicado primeiro: libera a chave nova pra row que tem os dados do usuário.
  retire: { id: string; externalId: string }[];
  rekey: { id: string; fromKey: string; externalId: string; kickoffAt: Date }[];
  supersede: { id: string; externalId: string; hasUserData: boolean }[];
};

const EMPTY_PLAN: ReschedulePlan = { retire: [], rekey: [], supersede: [] };

function pairKey(x: { league: string; homeTeam: string; awayTeam: string }): string {
  return `${x.league}:${x.homeTeam}:${x.awayTeam}`;
}

/**
 * Puro. `fixtures` é a temporada inteira das ligas que o provider respondeu nesta
 * rodada; `rows`, as rows dessas ligas (com folga, ver RESCHEDULE_LOOKBACK_MS). Uma
 * row aberta com kickoff a partir de `orphanSince`, cuja chave sumiu do provider e
 * cujo confronto aparece lá com outro horário (o mais próximo, até
 * RESCHEDULE_MAX_SHIFT_MS), foi remarcada:
 * - ninguém tem a chave nova: a herda a cópia mais próxima do horário novo que tem
 *   dados do usuário (sem nenhuma com dados, a mais próxima);
 * - a chave nova já tem row (sync de antes desta correção): fica a row com os dados do
 *   usuário. Se só a velha tem, a nova é aposentada (em qualquer fase: se já encerrou,
 *   o upsert passa o placar pra velha, que liquida) e a velha herda a chave; senão as
 *   velhas são aposentadas. Juntar duas rows com dados não é feito aqui (log
 *   `superseded_with_user_data` pra acerto manual).
 * As demais cópias velhas são aposentadas. Sem par no provider, nada muda (pode ser só
 * um buraco do provider). Row já aposentada (SUPERSEDED_KEY_PREFIX) nunca entra.
 */
export function planRescheduledFixtures(
  rows: readonly RescheduleRow[],
  fixtures: readonly NormalizedFixture[],
  { orphanSince = new Date(0) }: { orphanSince?: Date } = {},
): ReschedulePlan {
  const providerKeys = new Set(fixtures.map((f) => compositeFixtureKey(f)));
  const rowsByKey = new Map(rows.map((r) => [r.externalId, r]));
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
    if (
      !OPEN_STATUSES.has(row.status) ||
      row.externalId.startsWith(SUPERSEDED_KEY_PREFIX) ||
      row.kickoffAt.getTime() < orphanSince.getTime() ||
      providerKeys.has(row.externalId)
    ) {
      continue;
    }
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

  const plan: ReschedulePlan = { retire: [], rekey: [], supersede: [] };
  for (const [key, { target, orphans }] of orphansByTarget) {
    orphans.sort((a, b) => a.shift - b.shift || a.row.id.localeCompare(b.row.id));
    const existing = rowsByKey.get(key);
    const heir =
      existing === undefined
        ? (orphans.find((o) => o.row.hasUserData) ?? orphans[0]).row
        : !existing.hasUserData
          ? orphans.find((o) => o.row.hasUserData)?.row
          : undefined;
    if (existing !== undefined && heir !== undefined) {
      plan.retire.push({ id: existing.id, externalId: existing.externalId });
    }
    if (heir !== undefined) {
      plan.rekey.push({
        id: heir.id,
        fromKey: heir.externalId,
        externalId: key,
        kickoffAt: new Date(target.kickoffTimestampMs),
      });
    }
    for (const { row } of orphans) {
      if (row !== heir) {
        plan.supersede.push({
          id: row.id,
          externalId: row.externalId,
          hasUserData: row.hasUserData,
        });
      }
    }
  }
  return plan;
}

/**
 * Aplica o plano antes do upsert do sync, na ordem aposentar → herdar → aposentar o
 * resto. Cada passo é um UPDATE idempotente (o driver HTTP do Neon não tem transação
 * interativa): uma falha no meio deixa o resto pra próxima rodada, que replaneja do
 * zero (uma row aposentada sem herdeiro ainda é achada como órfã e herda a chave).
 */
export async function reconcileRescheduledFixtures(
  fixtures: readonly NormalizedFixture[],
  now: Date = new Date(),
): Promise<ReschedulePlan> {
  const leagues = [...new Set(fixtures.map((f) => f.league))];
  if (leagues.length === 0) return EMPTY_PLAN;
  const orphanSince = new Date(now.getTime() - RESCHEDULE_LOOKBACK_MS);
  const rows = await getReschedulableMatches({
    leagues,
    since: new Date(orphanSince.getTime() - RESCHEDULE_MAX_SHIFT_MS),
  });
  const plan = planRescheduledFixtures(rows, fixtures, { orphanSince });
  await markMatchesSuperseded(plan.retire.map((r) => r.id));
  for (const r of plan.rekey) {
    await rekeyMatch(r);
  }
  await markMatchesSuperseded(plan.supersede.map((s) => s.id));
  const stranded = plan.supersede.filter((s) => s.hasUserData);
  if (stranded.length > 0) {
    console.warn(
      JSON.stringify({
        scope: "sync-upcoming-fixtures",
        event: "superseded_with_user_data",
        matchIds: stranded.map((s) => s.id),
      }),
    );
  }
  if (plan.retire.length + plan.rekey.length + plan.supersede.length > 0) {
    console.info(
      JSON.stringify({
        scope: "sync-upcoming-fixtures",
        event: "matches_rescheduled",
        rekeyed: plan.rekey.map((r) => ({ matchId: r.id, from: r.fromKey, to: r.externalId })),
        retired: [...plan.retire, ...plan.supersede].map((r) => r.externalId),
      }),
    );
  }
  return plan;
}
