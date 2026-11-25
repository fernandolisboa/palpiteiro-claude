import { and, asc, desc, eq, gte, inArray, lte, not, sql } from "drizzle-orm";

import { matchNews, matchNewsBatches } from "@/db/schema";
import { db } from "@/lib/db";
import {
  NewsClaimSchema,
  StoredNewsBatchSchema,
  type MatchNewsBatchItem,
  type MatchNewsBatchStatus,
  type MatchNewsFeedSide,
  type NewsClaim,
  type StoredNewsBatch,
} from "@/lib/match-news/types";

// Fronteira ÚNICA de `match_news` e `match_news_batches` (#672, PLAN-672 §2). Escrita
// idempotente (o cron pode rodar de novo, sobreposto ou depois de morrer no meio): item
// único por (jogo, URL) e lote único por (jogo, hash, versão do prompt). Toda leitura
// de lote passa pelo Zod (jsonb); row inválida → omitida com log, nunca derruba o cron.
// Afirmação inválida dentro de um lote válido cai sozinha (com log): o lote segue usável.

export type NewMatchNewsItem = {
  url: string;
  title: string;
  snippet: string | null;
  publishedAt: Date;
  feedSide: MatchNewsFeedSide | null;
};

export type MatchNewsRow = typeof matchNews.$inferSelect;

/**
 * Upsert dos itens do jogo: URL nova entra; URL conhecida só muda quando o título ou o
 * trecho mudaram (matéria atualizada; `updated_at` anda). `feed_side` e `first_seen_at`
 * ficam os da primeira vez. Devolve as rows dos itens pedidos, na ordem pedida.
 */
export async function upsertMatchNews(
  matchId: string,
  items: readonly NewMatchNewsItem[],
  now: Date = new Date(),
): Promise<MatchNewsRow[]> {
  if (items.length === 0) return [];
  // A mesma URL duas vezes no mesmo INSERT … ON CONFLICT DO UPDATE é erro no Postgres.
  const unique = [...new Map(items.map((i) => [i.url, i])).values()];
  await db
    .insert(matchNews)
    .values(
      unique.map((i) => ({
        matchId,
        url: i.url,
        title: i.title,
        snippet: i.snippet,
        publishedAt: i.publishedAt,
        feedSide: i.feedSide,
        firstSeenAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [matchNews.matchId, matchNews.url],
      set: {
        title: sql`excluded.title`,
        snippet: sql`excluded.snippet`,
        publishedAt: sql`excluded.published_at`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${matchNews.title} IS DISTINCT FROM excluded.title OR ${matchNews.snippet} IS DISTINCT FROM excluded.snippet`,
    });
  const rows = await db
    .select()
    .from(matchNews)
    .where(
      and(
        eq(matchNews.matchId, matchId),
        inArray(
          matchNews.url,
          unique.map((i) => i.url),
        ),
      ),
    );
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  return unique.flatMap((i) => {
    const r = byUrl.get(i.url);
    return r ? [r] : [];
  });
}

/** Itens guardados do jogo publicados em [from, to], de um feed (ou todos), mais novo primeiro. */
export async function listMatchNewsInWindow(
  matchId: string,
  opts: { from: Date; to: Date; feedSide?: MatchNewsFeedSide },
): Promise<MatchNewsRow[]> {
  return db
    .select()
    .from(matchNews)
    .where(
      and(
        eq(matchNews.matchId, matchId),
        gte(matchNews.publishedAt, opts.from),
        lte(matchNews.publishedAt, opts.to),
        ...(opts.feedSide ? [eq(matchNews.feedSide, opts.feedSide)] : []),
      ),
    )
    .orderBy(desc(matchNews.publishedAt), asc(matchNews.url));
}

/** Os itens guardados por id (o trecho da extração mora aqui). */
export async function getMatchNewsByIds(ids: readonly string[]): Promise<MatchNewsRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(matchNews)
    .where(inArray(matchNews.id, [...ids]));
}

type BatchRow = typeof matchNewsBatches.$inferSelect;

function parseBatch(row: BatchRow): StoredNewsBatch | null {
  // Item a item: uma afirmação que não volta a passar no Zod (gravada por uma versão
  // anterior do extrator, por exemplo) não derruba o lote inteiro, senão o cron
  // re-extrairia (e pagaria) em todo run.
  const rawClaims: unknown = row.claims;
  let claims: unknown = rawClaims;
  if (Array.isArray(rawClaims)) {
    const valid = rawClaims.flatMap((c: unknown) => {
      const p = NewsClaimSchema.safeParse(c);
      return p.success ? [p.data] : [];
    });
    if (valid.length < rawClaims.length) {
      console.warn(
        JSON.stringify({
          scope: "match_news_batches",
          event: "invalid_batch_claims_dropped",
          batchId: row.id,
          matchId: row.matchId,
          dropped: rawClaims.length - valid.length,
        }),
      );
    }
    claims = valid;
  }
  const parsed = StoredNewsBatchSchema.safeParse({ ...row, claims });
  if (parsed.success) return parsed.data;
  console.error(
    JSON.stringify({
      scope: "match_news_batches",
      error: "invalid_batch_row",
      batchId: row.id,
      matchId: row.matchId,
      issues: parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }),
  );
  return null;
}

export async function findMatchNewsBatch(
  matchId: string,
  batchHash: string,
  promptVersion: string,
): Promise<StoredNewsBatch | null> {
  const [row] = await db
    .select()
    .from(matchNewsBatches)
    .where(
      and(
        eq(matchNewsBatches.matchId, matchId),
        eq(matchNewsBatches.batchHash, batchHash),
        eq(matchNewsBatches.promptVersion, promptVersion),
      ),
    )
    .limit(1);
  return row ? parseBatch(row) : null;
}

export type NewMatchNewsBatch = {
  matchId: string;
  batchHash: string;
  promptVersion: string;
  items: MatchNewsBatchItem[];
  status: MatchNewsBatchStatus;
  claims: NewsClaim[];
  warnings: string[];
  partial: boolean;
  unknownOpponent: boolean;
  aiCallId: string | null;
  now: Date;
  // Hora real (relógio do run) em que o lote ficou usável; null quando `failed`.
  usableAt: Date | null;
};

/**
 * Lote novo. Corrida (dois runs gravando o mesmo lote): o segundo não grava e devolve o
 * do primeiro (ON CONFLICT DO NOTHING + releitura).
 */
export async function insertMatchNewsBatch(
  b: NewMatchNewsBatch,
): Promise<StoredNewsBatch | null> {
  await db
    .insert(matchNewsBatches)
    .values({
      matchId: b.matchId,
      batchHash: b.batchHash,
      promptVersion: b.promptVersion,
      items: b.items,
      status: b.status,
      claims: b.claims,
      warnings: b.warnings,
      partial: b.partial,
      unknownOpponent: b.unknownOpponent,
      aiCallId: b.aiCallId,
      createdAt: b.now,
      checkedAt: b.now,
      usableAt: b.status === "failed" ? null : b.usableAt,
    })
    .onConflictDoNothing({
      target: [
        matchNewsBatches.matchId,
        matchNewsBatches.batchHash,
        matchNewsBatches.promptVersion,
      ],
    });
  return findMatchNewsBatch(b.matchId, b.batchHash, b.promptVersion);
}

// Heartbeat monotônico (um run atrasado nunca recua o relógio).
export async function touchMatchNewsBatch(id: string, now: Date): Promise<void> {
  await db
    .update(matchNewsBatches)
    .set({
      checkedAt: sql`GREATEST(${matchNewsBatches.checkedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(eq(matchNewsBatches.id, id));
}

/** Nova tentativa de um lote `failed`: conta a tentativa e grava o desfecho dela. */
export async function markMatchNewsBatchRetry(
  id: string,
  r: {
    status: MatchNewsBatchStatus;
    claims: NewsClaim[];
    warnings: string[];
    aiCallId: string | null;
    now: Date;
    usableAt: Date | null;
  },
): Promise<StoredNewsBatch | null> {
  const [row] = await db
    .update(matchNewsBatches)
    .set({
      attempts: sql`${matchNewsBatches.attempts} + 1`,
      status: r.status,
      claims: r.claims,
      warnings: r.warnings,
      aiCallId: r.aiCallId,
      usableAt: r.status === "failed" ? null : r.usableAt,
      checkedAt: sql`GREATEST(${matchNewsBatches.checkedAt}, ${r.now.toISOString()}::timestamptz)`,
    })
    .where(eq(matchNewsBatches.id, id))
    .returning();
  return row ? parseBatch(row) : null;
}

// Usável: extraído (ok) ou sem item (empty), visto pelo cron desde `since`. Um `empty`
// com adversário fora da tabela não prova "nada novo" e não é usável.
const usable = (since: Date, promptVersion: string) =>
  and(
    eq(matchNewsBatches.promptVersion, promptVersion),
    inArray(matchNewsBatches.status, ["ok", "empty"]),
    gte(matchNewsBatches.checkedAt, since),
    not(
      and(
        eq(matchNewsBatches.status, "empty"),
        eq(matchNewsBatches.unknownOpponent, true),
      )!,
    ),
  );

/** O lote usável mais recente do jogo (o último visto pelo cron), ou null. */
export async function getLatestUsableNewsBatch(
  matchId: string,
  opts: { since: Date; promptVersion: string },
): Promise<StoredNewsBatch | null> {
  const rows = await db
    .select()
    .from(matchNewsBatches)
    .where(and(eq(matchNewsBatches.matchId, matchId), usable(opts.since, opts.promptVersion)))
    .orderBy(desc(matchNewsBatches.checkedAt), desc(matchNewsBatches.createdAt))
    .limit(3);
  for (const row of rows) {
    const parsed = parseBatch(row);
    if (parsed) return parsed;
  }
  return null;
}

/** O lote usável mais recente de cada jogo, numa leitura (fila JEV do cron). */
export async function getLatestUsableNewsBatchesForMatches(
  matchIds: readonly string[],
  opts: { since: Date; promptVersion: string },
): Promise<Map<string, StoredNewsBatch>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([matchNewsBatches.matchId])
    .from(matchNewsBatches)
    .where(
      and(inArray(matchNewsBatches.matchId, [...matchIds]), usable(opts.since, opts.promptVersion)),
    )
    .orderBy(
      matchNewsBatches.matchId,
      desc(matchNewsBatches.checkedAt),
      desc(matchNewsBatches.createdAt),
    );
  const out = new Map<string, StoredNewsBatch>();
  for (const row of rows) {
    const parsed = parseBatch(row);
    if (parsed) out.set(parsed.matchId, parsed);
  }
  return out;
}

/**
 * O lote que a ANÁLISE lê (#672, C2): o usável mais recente visto pelo cron desde
 * `since` e, sem nenhum usável, se o cron viu um lote que a extração não conseguiu ler
 * (`failed`): a análise segue no caminho ao vivo e o passo diz que as notícias de hoje
 * ainda não foram conferidas. Uma leitura só, pelo índice (match_id, checked_at).
 */
export async function getNewsBatchForAnalysis(
  matchId: string,
  opts: { since: Date; promptVersion: string },
): Promise<{ usable: StoredNewsBatch | null; failedOnly: boolean }> {
  const rows = await db
    .select()
    .from(matchNewsBatches)
    .where(
      and(
        eq(matchNewsBatches.matchId, matchId),
        eq(matchNewsBatches.promptVersion, opts.promptVersion),
        gte(matchNewsBatches.checkedAt, opts.since),
      ),
    )
    .orderBy(desc(matchNewsBatches.checkedAt), desc(matchNewsBatches.createdAt))
    .limit(5);
  // A mesma regra de `usable` (acima): ok ou empty, e empty com adversário fora da
  // tabela não prova "nada novo".
  const isUsable = (r: BatchRow) =>
    r.status === "ok" || (r.status === "empty" && !r.unknownOpponent);
  for (const row of rows) {
    if (!isUsable(row)) continue;
    const parsed = parseBatch(row);
    if (parsed) return { usable: parsed, failedOnly: false };
  }
  return { usable: null, failedOnly: rows.some((r) => r.status === "failed") };
}
