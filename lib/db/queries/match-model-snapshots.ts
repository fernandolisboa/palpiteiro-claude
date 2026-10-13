import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { matchModelSnapshots, matches } from "@/db/schema";
import { db } from "@/lib/db";
import {
  matchModelJudgmentsSchema,
  matchModelSnapshotSchema,
  type MatchModelJudgments,
  type MatchModelSnapshot,
} from "@/lib/model-base/types";

// Fronteira ÚNICA de `match_model_snapshots` (#555, ADR 0052). Escrita: insert de row
// nova (fingerprint mudou) ou heartbeat de `checked_at` (mesmo fingerprint). Leitura:
// toda row passa pelo Zod (jsonb e enums em text); inválida → omitida com log, nunca
// derruba a página nem o cron. Exceção: `judgments` que não bate com o conjunto ATUAL
// de perguntas (mudança de versão do JEV) não derruba a row nas leituras de exibição
// (/jogos, "Leitura do modelo", seam do cupom, fila do cron): vem como null. O reuso
// JEV (`findReusableSnapshotJudgments`) segue estrito.

export type NewMatchModelSnapshot = typeof matchModelSnapshots.$inferInsert;

type SnapshotRow = typeof matchModelSnapshots.$inferSelect;

function parseSnapshot(row: SnapshotRow): MatchModelSnapshot | null {
  const parsed = matchModelSnapshotSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  const onlyJudgments = parsed.error.issues.every(
    (i) => i.path[0] === "judgments",
  );
  if (onlyJudgments) {
    const lenient = matchModelSnapshotSchema.safeParse({
      ...row,
      judgments: null,
    });
    if (lenient.success) {
      console.warn(
        JSON.stringify({
          scope: "match_model_snapshots",
          event: "snapshot_judgments_unparsed",
          snapshotId: row.id,
          matchId: row.matchId,
        }),
      );
      return lenient.data;
    }
  }
  console.error(
    JSON.stringify({
      scope: "match_model_snapshots",
      error: "invalid_snapshot_row",
      snapshotId: row.id,
      matchId: row.matchId,
      issues: parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }),
  );
  return null;
}

export async function insertMatchModelSnapshot(
  row: NewMatchModelSnapshot,
): Promise<string> {
  const [inserted] = await db
    .insert(matchModelSnapshots)
    .values(row)
    .returning({ id: matchModelSnapshots.id });
  return inserted.id;
}

// Heartbeat: o run recalculou e achou o mesmo fingerprint. GREATEST deixa o relógio
// monotônico (um run atrasado ou sobreposto nunca recua o `checked_at`). É o único
// UPDATE da tabela; o conteúdo da row nunca muda.
export async function touchMatchModelSnapshot(
  id: string,
  checkedAt: Date,
): Promise<void> {
  await db
    .update(matchModelSnapshots)
    .set({
      checkedAt: sql`GREATEST(${matchModelSnapshots.checkedAt}, ${checkedAt.toISOString()}::timestamptz)`,
    })
    .where(eq(matchModelSnapshots.id, id));
}

export async function getLatestMatchModelSnapshot(
  matchId: string,
): Promise<MatchModelSnapshot | null> {
  const [row] = await db
    .select()
    .from(matchModelSnapshots)
    .where(eq(matchModelSnapshots.matchId, matchId))
    .orderBy(
      desc(matchModelSnapshots.computedAt),
      desc(matchModelSnapshots.checkedAt),
    )
    .limit(1);
  return row ? parseSnapshot(row) : null;
}

/**
 * Última base de cada jogo (DISTINCT ON match_id, a de `computed_at` mais recente),
 * numa leitura só (lista /jogos, fila do cron). Jogo sem base ou com a última row
 * inválida fica fora do Map.
 */
export async function getLatestMatchModelSnapshotsForMatches(
  matchIds: string[],
): Promise<Map<string, MatchModelSnapshot>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([matchModelSnapshots.matchId])
    .from(matchModelSnapshots)
    .where(inArray(matchModelSnapshots.matchId, matchIds))
    .orderBy(
      matchModelSnapshots.matchId,
      desc(matchModelSnapshots.computedAt),
      desc(matchModelSnapshots.checkedAt),
    );
  const out = new Map<string, MatchModelSnapshot>();
  for (const row of rows) {
    const snapshot = parseSnapshot(row);
    if (snapshot) out.set(snapshot.matchId, snapshot);
  }
  return out;
}

/**
 * Última base do jogo + o kickoff, num round-trip (seam do cupom,
 * lib/model-base/model-scoreline.ts). null sem base ou com a última row inválida.
 */
export async function getLatestMatchModelSnapshotWithKickoff(
  matchId: string,
): Promise<{ snapshot: MatchModelSnapshot; kickoffAt: Date } | null> {
  const [row] = await db
    .select({ snapshot: matchModelSnapshots, kickoffAt: matches.kickoffAt })
    .from(matchModelSnapshots)
    .innerJoin(matches, eq(matchModelSnapshots.matchId, matches.id))
    .where(eq(matchModelSnapshots.matchId, matchId))
    .orderBy(
      desc(matchModelSnapshots.computedAt),
      desc(matchModelSnapshots.checkedAt),
    )
    .limit(1);
  if (!row) return null;
  const snapshot = parseSnapshot(row.snapshot);
  return snapshot ? { snapshot, kickoffAt: row.kickoffAt } : null;
}

/**
 * Respostas JEV reaproveitáveis da base (origem snapshot do reuso do predict, #555).
 * Mesmos filtros jsonb do findReusableJudgments (applied, stateHash, versões, modelo JEV
 * pinado), sobre o `checked_at` (a row fica com o `computed_at` antigo enquanto o
 * resultado não muda). `jsonb_typeof(answers) = 'object'`: o JSON null em jsonb NÃO é
 * SQL NULL. Com mais de uma candidata, a de `checked_at` mais recente.
 */
export async function findReusableSnapshotJudgments(args: {
  matchId: string;
  judgmentsVersion: string;
  weightsVersion: string;
  jevModel: string;
  stateHash: string;
  since: Date;
}): Promise<{ snapshotId: string; judgments: MatchModelJudgments } | null> {
  const j = matchModelSnapshots.judgments;
  const [row] = await db
    .select({ id: matchModelSnapshots.id, judgments: j })
    .from(matchModelSnapshots)
    .where(
      and(
        eq(matchModelSnapshots.matchId, args.matchId),
        gte(matchModelSnapshots.checkedAt, args.since),
        sql`${j}->>'applied' = 'true'`,
        sql`jsonb_typeof(${j}->'answers') = 'object'`,
        sql`${j}->>'stateHash' = ${args.stateHash}`,
        sql`${j}->'versions'->>'judgments' = ${args.judgmentsVersion}`,
        sql`${j}->'versions'->>'weights' = ${args.weightsVersion}`,
        sql`${j}->'versions'->>'jevModel' = ${args.jevModel}`,
      ),
    )
    .orderBy(desc(matchModelSnapshots.checkedAt))
    .limit(1);
  if (!row) return null;
  const parsed = matchModelJudgmentsSchema.safeParse(row.judgments);
  if (!parsed.success || !parsed.data.answers) {
    console.error(
      JSON.stringify({
        scope: "match_model_snapshots",
        error: "invalid_snapshot_judgments",
        snapshotId: row.id,
      }),
    );
    return null;
  }
  return { snapshotId: row.id, judgments: parsed.data };
}
