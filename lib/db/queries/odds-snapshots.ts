import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { matchOddsSnapshots, selectionOddsSnapshots } from "@/db/schema";
import { db } from "@/lib/db";
import { resolveMarketCatalog } from "@/lib/db/queries/market-catalog";
import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";

export type DbOddsSnapshot = typeof matchOddsSnapshots.$inferSelect;

export async function getLatestOddsSnapshot(
  matchId: string,
): Promise<DbOddsSnapshot | null> {
  const rows = await db
    .select()
    .from(matchOddsSnapshots)
    .where(
      and(
        eq(matchOddsSnapshots.matchId, matchId),
        eq(matchOddsSnapshots.market, "over_under_2_5"),
      ),
    )
    .orderBy(desc(matchOddsSnapshots.capturedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Snapshot mais recente do match SOMENTE se ainda fresca (< TTL externo de
 * 30min, mesma definição que ensureOddsSnapshotsFresh usa em isFresh()).
 * Retorna null se não há snapshot ou se a existente já está stale.
 *
 * Comparador `<` idêntico ao de isFresh() pra que predict() (reuso) e
 * ensureOddsSnapshotsFresh (refetch) nunca discordem na fronteira de idade.
 */
export async function getLatestFreshOddsSnapshot(
  matchId: string,
  now: Date = new Date(),
): Promise<DbOddsSnapshot | null> {
  const snapshot = await getLatestOddsSnapshot(matchId);
  if (!snapshot) return null;
  const ageMs = now.getTime() - snapshot.capturedAt.getTime();
  return ageMs < ODDS_SNAPSHOT_FRESHNESS_MS ? snapshot : null;
}

/**
 * Batch read das snapshots MAIS RECENTES de over/under 2.5 pra cada match.
 * Uma query só (DISTINCT ON via subquery), nunca dispara fetch externo.
 * Usada pela home pra evitar N+1. Matches sem snapshot ficam fora do Map.
 */
export async function getLatestOddsSnapshotsForMatches(
  matchIds: string[],
): Promise<Map<string, DbOddsSnapshot>> {
  if (matchIds.length === 0) return new Map();

  // Postgres DISTINCT ON: pra cada match_id, pega a row com captured_at mais
  // recente. ORDER BY match_id, captured_at DESC é obrigatório.
  const rows = await db
    .selectDistinctOn([matchOddsSnapshots.matchId])
    .from(matchOddsSnapshots)
    .where(
      and(
        inArray(matchOddsSnapshots.matchId, matchIds),
        eq(matchOddsSnapshots.market, "over_under_2_5"),
      ),
    )
    .orderBy(matchOddsSnapshots.matchId, desc(matchOddsSnapshots.capturedAt));

  const out = new Map<string, DbOddsSnapshot>();
  for (const row of rows) {
    out.set(row.matchId, row);
  }
  return out;
}

export type InsertOddsSnapshotArgs = {
  matchId: string;
  bookmaker: string;
  overOdd: number;
  underOdd: number;
  overroundPct: number;
};

export async function insertOddsSnapshot(
  args: InsertOddsSnapshotArgs,
): Promise<void> {
  await db.insert(matchOddsSnapshots).values({
    matchId: args.matchId,
    bookmaker: args.bookmaker,
    market: "over_under_2_5",
    line: "2.5",
    overOdd: args.overOdd.toFixed(3),
    underOdd: args.underOdd.toFixed(3),
    overroundPct: args.overroundPct.toFixed(2),
  });
}

/**
 * Insert binário (tabela LEGADA `match_odds_snapshots`). Retorna o query builder
 * NÃO-awaited pra caber em `db.batch([...])` — neon-http não tem `db.transaction`
 * (LANÇA em runtime; ver `invites.ts`). Callers que só querem inserir podem
 * `await` o retorno normalmente.
 *
 * `capturedAt` é OPCIONAL: por default cai no `defaultNow()` do schema (back-compat
 * com o comportamento atual). O dual-write (#164) passa o MESMO `now` de escrita às
 * DUAS tabelas EXPLICITAMENTE, garantindo `old.captured_at === new.captured_at` —
 * impossível se a velha ficasse em `defaultNow()` e a nova em outro valor.
 *
 * NÃO chamar com `rows` vazio (`.values([])` falha) — o caller guarda emptiness.
 */
export function insertOddsSnapshotsBatch(
  rows: InsertOddsSnapshotArgs[],
  capturedAt?: Date,
) {
  return db.insert(matchOddsSnapshots).values(
    rows.map((r) => ({
      matchId: r.matchId,
      bookmaker: r.bookmaker,
      market: "over_under_2_5" as const,
      line: "2.5",
      overOdd: r.overOdd.toFixed(3),
      underOdd: r.underOdd.toFixed(3),
      overroundPct: r.overroundPct.toFixed(2),
      ...(capturedAt ? { capturedAt } : {}),
    })),
  );
}

// ─── Tabela genérica `selection_odds_snapshots` (N seleções, #164) ───────────
// A generalização N-vias de `match_odds_snapshots`. Uma row por seleção; a
// captura inteira de UM book compartilha o MESMO (captured_at, bookmaker,
// overround_pct). As binárias acima ficam intactas (par over/under legado).

export type SelectionSnapshotRow = {
  matchId: string;
  marketId: string;
  selectionId: string;
  marketParams: { line: number } | null;
  odd: string; // Drizzle numeric = string; já formatada no boundary (.toFixed(3)).
  overroundPct: string; // idem (.toFixed(2)).
  bookmaker: string;
  capturedAt: Date; // EXPLÍCITO — o now de escrita, igual pras N rows da captura.
};

/**
 * Insert genérico (tabela `selection_odds_snapshots`). `onConflictDoNothing` na
 * chave de 5 colunas (match, market, selection, captured_at, bookmaker) — a mesma
 * que ancora a idempotência do backfill (#162). Retorna o query builder NÃO-awaited
 * pra caber em `db.batch([...])` (ver `insertOddsSnapshotsBatch`). NÃO chamar com
 * `rows` vazio — o caller guarda emptiness.
 */
export function insertSelectionOddsSnapshotsBatch(rows: SelectionSnapshotRow[]) {
  return db
    .insert(selectionOddsSnapshots)
    .values(
      rows.map((r) => ({
        matchId: r.matchId,
        marketId: r.marketId,
        selectionId: r.selectionId,
        marketParams: r.marketParams,
        odd: r.odd,
        overroundPct: r.overroundPct,
        bookmaker: r.bookmaker,
        capturedAt: r.capturedAt,
      })),
    )
    .onConflictDoNothing({
      target: [
        selectionOddsSnapshots.matchId,
        selectionOddsSnapshots.marketId,
        selectionOddsSnapshots.selectionId,
        selectionOddsSnapshots.capturedAt,
        selectionOddsSnapshots.bookmaker,
      ],
    });
}

export type LatestSelectionSnapshot = {
  bookmaker: string;
  capturedAt: Date;
  overroundPct: string;
  selections: { key: string; odd: string }[];
};

/**
 * Última captura de odds (mais recente por seleção) de um (match, market) na
 * tabela genérica. Padrão DISTINCT ON espelhando `getLatestOddsSnapshotsForMatches`
 * (odds-snapshots.ts) — `.selectDistinctOn([selectionId])` + ORDER BY começando
 * por `selectionId` (obrigatório no Postgres) e `desc(capturedAt)`.
 *
 * Como toda captura é ATÔMICA (db.batch escreve as N rows com o MESMO
 * captured_at/bookmaker), "última por seleção" colapsa em "última captura". O
 * código ASSERTA isso: hard-fail se as N rows divergem em (capturedAt, bookmaker)
 * — sem isso poderia montar um book Frankenstein misturando capturas.
 *
 * Para over_under, o predicado de `line` é OBRIGATÓRIO (`market_params->>'line'`):
 * sem ele 2.5 e 3.5 — mesmo marketId/selectionId — se misturariam. h2h omite.
 * `line` é gravado como NUMBER no jsonb; comparado via `->>'line'` (text) contra
 * `String(line)`.
 *
 * Retorna null se não há nenhuma row (match sem captura desse mercado/linha).
 */
export async function getLatestSelectionOddsSnapshots(args: {
  matchId: string;
  dbMarketKey: string;
  params?: { line: number };
}): Promise<LatestSelectionSnapshot | null> {
  const { matchId, dbMarketKey, params } = args;
  const { marketId, keyById } = await resolveMarketCatalog(dbMarketKey);

  const conditions = [
    eq(selectionOddsSnapshots.matchId, matchId),
    eq(selectionOddsSnapshots.marketId, marketId),
  ];
  if (params) {
    conditions.push(
      sql`${selectionOddsSnapshots.marketParams}->>'line' = ${String(params.line)}`,
    );
  }

  const rows = await db
    .selectDistinctOn([selectionOddsSnapshots.selectionId])
    .from(selectionOddsSnapshots)
    .where(and(...conditions))
    .orderBy(
      selectionOddsSnapshots.selectionId,
      desc(selectionOddsSnapshots.capturedAt),
    );

  if (rows.length === 0) return null;

  // Coerência: todas as rows da "última captura" precisam compartilhar o MESMO
  // (capturedAt, bookmaker). Divergência = book Frankenstein → hard-fail.
  const first = rows[0];
  for (const r of rows) {
    if (
      r.capturedAt.getTime() !== first.capturedAt.getTime() ||
      r.bookmaker !== first.bookmaker
    ) {
      throw new Error(
        `getLatestSelectionOddsSnapshots: captura incoerente para match=${matchId} market=${dbMarketKey} — rows divergem em (capturedAt, bookmaker)`,
      );
    }
  }

  // Completude: a captura tem que cobrir TODAS as seleções do mercado. Um bundle
  // coerente-mas-parcial (faltando seleção) alimentaria overround/edge sobre um
  // mercado incompleto — landmine de normalização do CLAUDE.md, e o #165 consome
  // `selections` justamente pra calcular edge. Hard-fail em vez de devolver curto
  // em silêncio (o write atômico torna parcial impossível hoje; isto é a guarda).
  if (rows.length !== keyById.size) {
    throw new Error(
      `getLatestSelectionOddsSnapshots: captura incompleta para match=${matchId} market=${dbMarketKey} — ${rows.length}/${keyById.size} seleções`,
    );
  }

  const selections = rows.map((r) => {
    const key = keyById.get(r.selectionId);
    if (!key) {
      throw new Error(
        `selection_id ${r.selectionId} não pertence ao market '${dbMarketKey}'`,
      );
    }
    return { key, odd: r.odd };
  });

  return {
    bookmaker: first.bookmaker,
    capturedAt: first.capturedAt,
    overroundPct: first.overroundPct,
    selections,
  };
}

/**
 * Última captura genérica SOMENTE se fresca (< TTL externo de 30min) — mesma
 * constante/comparador `<` de `getLatestFreshOddsSnapshot`, pra que reuso e
 * refetch nunca discordem na fronteira de idade. Retorna null se não há captura
 * ou se a existente já está stale.
 */
export async function getLatestFreshSelectionOddsSnapshots(
  args: { matchId: string; dbMarketKey: string; params?: { line: number } },
  now: Date = new Date(),
): Promise<LatestSelectionSnapshot | null> {
  const latest = await getLatestSelectionOddsSnapshots(args);
  if (!latest) return null;
  const ageMs = now.getTime() - latest.capturedAt.getTime();
  return ageMs < ODDS_SNAPSHOT_FRESHNESS_MS ? latest : null;
}

// Re-export for callers that compose further
export { sql };
