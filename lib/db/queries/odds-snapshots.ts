import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { marketSelections, selectionOddsSnapshots } from "@/db/schema";
import { db } from "@/lib/db";
import { resolveMarketCatalog } from "@/lib/db/queries/market-catalog";
import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";

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
 * pra poder compor em `db.batch([...])` (neon-http não tem transação). NÃO chamar
 * com `rows` vazio — o caller guarda emptiness.
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
      // Espelha o unique `selection_odds_snapshots_dedup_key` (inclui marketParams,
      // #175) — sem a linha aqui, o arbiter não casaria a constraint nova e o insert
      // multi-linha falharia/colidiria. NULLS NOT DISTINCT no índice cobre btts/dc.
      target: [
        selectionOddsSnapshots.matchId,
        selectionOddsSnapshots.marketId,
        selectionOddsSnapshots.selectionId,
        selectionOddsSnapshots.capturedAt,
        selectionOddsSnapshots.bookmaker,
        selectionOddsSnapshots.marketParams,
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
 * tabela genérica. Padrão DISTINCT ON: `.selectDistinctOn([selectionId])` + ORDER BY
 * começando por `selectionId` (obrigatório no Postgres) e `desc(capturedAt)`.
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
 * Última captura genérica SOMENTE se fresca (< TTL externo) — mesmo comparador
 * `<` que reuso e refetch compartilham, pra nunca discordarem na fronteira de
 * idade. Retorna null se não há captura ou se a existente já está stale.
 *
 * `freshnessMs` é OPCIONAL e default = ODDS_SNAPSHOT_FRESHNESS_MS (30min): os
 * callers que o omitem (predict.ts, leituras) mantêm EXATAMENTE o comportamento de
 * hoje (back-compat por construção). `ensureOddsSnapshotsFresh` passa uma janela em
 * função do tempo-até-kickoff (oddsFreshnessMsForKickoff) — mais larga só pra jogos
 * distantes (>24h), nunca pro conjunto de captura do CLV (KO ≤90min).
 */
export async function getLatestFreshSelectionOddsSnapshots(
  args: { matchId: string; dbMarketKey: string; params?: { line: number } },
  now: Date = new Date(),
  freshnessMs: number = ODDS_SNAPSHOT_FRESHNESS_MS,
): Promise<LatestSelectionSnapshot | null> {
  const latest = await getLatestSelectionOddsSnapshots(args);
  if (!latest) return null;
  const ageMs = now.getTime() - latest.capturedAt.getTime();
  return ageMs < freshnessMs ? latest : null;
}

// Última captura por seleção, ORDENADA pela ordem canônica do mercado
// (market_selections.sortOrder). Distinta de LatestSelectionSnapshot: aqui as
// seleções vêm na ordem de DISPLAY (home→draw→away), não em selectionId.
export type OrderedSelectionSnapshot = {
  bookmaker: string;
  capturedAt: Date;
  overroundPct: string;
  selections: { key: string; odd: string }[];
};

type BatchReaderRow = {
  matchId: string;
  key: string;
  sortOrder: number;
  capturedAt: Date;
  bookmaker: string;
  overroundPct: string;
  odd: string;
};

/**
 * Batch read N-vias BEST-EFFORT pra DISPLAY (card ao vivo + chips da home). Pra
 * cada match, a última captura (mais recente por seleção) do `dbMarketKey`, com as
 * seleções na ordem canônica (`market_selections.sortOrder`).
 *
 * **NUNCA `throw`a** — diferente de `getLatestSelectionOddsSnapshots` (que
 * hard-faila p/ correção em predict): este roda no render SÍNCRONO da page/home,
 * então um match incompleto/incoerente é OMITIDO do Map (degrada p/ "sem odd"),
 * não derruba a página. Matches sem captura também ficam fora do Map.
 *
 * **Line-aware via `params`.** Sem `params` (match_result/no-line) NÃO aplica
 * predicado de linha. Mercados com escada (over/under) DEVEM passar `params: { line }`
 * — sem ele um caller over/under Frankenstein-mergearia 1.5/2.5/3.5 sob o mesmo
 * selectionId (o DISTINCT ON é por (match, selection), não por linha). Com o
 * predicado `market_params->>'line'`, cada (match, selection) colapsa na captura
 * mais recente DAQUELA linha.
 *
 * `sortOrder` é COLUNA do SELECT, ordenada em JS após agrupar — NUNCA no leading
 * ORDER BY (Postgres exige que o leading ORDER BY case com as colunas do DISTINCT ON).
 */
export async function getLatestSelectionOddsSnapshotsForMatches(
  matchIds: string[],
  dbMarketKey: string,
  params?: { line: number },
): Promise<Map<string, OrderedSelectionSnapshot>> {
  if (matchIds.length === 0) return new Map();
  const { marketId, keyById } = await resolveMarketCatalog(dbMarketKey);
  const expectedCount = keyById.size;

  const rows: BatchReaderRow[] = await db
    .selectDistinctOn(
      [selectionOddsSnapshots.matchId, selectionOddsSnapshots.selectionId],
      {
        matchId: selectionOddsSnapshots.matchId,
        key: marketSelections.key,
        sortOrder: marketSelections.sortOrder,
        capturedAt: selectionOddsSnapshots.capturedAt,
        bookmaker: selectionOddsSnapshots.bookmaker,
        overroundPct: selectionOddsSnapshots.overroundPct,
        odd: selectionOddsSnapshots.odd,
      },
    )
    .from(selectionOddsSnapshots)
    .innerJoin(
      marketSelections,
      eq(selectionOddsSnapshots.selectionId, marketSelections.id),
    )
    .where(
      and(
        eq(selectionOddsSnapshots.marketId, marketId),
        inArray(selectionOddsSnapshots.matchId, matchIds),
        ...(params
          ? [
              sql`${selectionOddsSnapshots.marketParams}->>'line' = ${String(params.line)}`,
            ]
          : []),
      ),
    )
    .orderBy(
      selectionOddsSnapshots.matchId,
      selectionOddsSnapshots.selectionId,
      desc(selectionOddsSnapshots.capturedAt),
    );

  const byMatch = new Map<string, BatchReaderRow[]>();
  for (const r of rows) {
    const list = byMatch.get(r.matchId);
    if (list) list.push(r);
    else byMatch.set(r.matchId, [r]);
  }

  const out = new Map<string, OrderedSelectionSnapshot>();
  for (const [matchId, group] of byMatch) {
    // Completude: a captura tem que cobrir TODAS as seleções (best-effort: omite,
    // não throw como o reader de correção).
    if (group.length !== expectedCount) continue;
    // Coerência: a "última captura" tem que compartilhar (capturedAt, bookmaker) —
    // senão é book Frankenstein. Omite.
    const first = group[0];
    const coherent = group.every(
      (r) =>
        r.capturedAt.getTime() === first.capturedAt.getTime() &&
        r.bookmaker === first.bookmaker,
    );
    if (!coherent) continue;
    const selections = [...group]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => ({ key: r.key, odd: r.odd }));
    out.set(matchId, {
      bookmaker: first.bookmaker,
      capturedAt: first.capturedAt,
      overroundPct: first.overroundPct,
      selections,
    });
  }
  return out;
}

// ─── over/under ao vivo (forma binária, da tabela genérica) ──────────────────
// A view do card/hero/chip over/under lê o par {overOdd, underOdd} congelado da
// captura mais recente. Na Fase 5 a fonte deixou de ser a tabela legada
// `match_odds_snapshots` e passou a ser `selection_odds_snapshots` (linha 2.5),
// adaptada de volta pra forma binária que page/match consomem (mesmos NOMES de
// campo). A escada 1.5/3.5 (#175) é filtrada pelo predicado de linha.

export type OverUnderSnapshot = {
  bookmaker: string;
  overOdd: string;
  underOdd: string;
  overroundPct: string;
  capturedAt: Date;
};

// over_under é a key do mercado (markets.key, seed) — NÃO o enum legado. Linha 2.5
// é a única exibida ao vivo (a escada alternativa do #175 fica fora do card).
const OVER_UNDER_DB_KEY = "over_under";
const OVER_UNDER_LIVE_LINE = 2.5;

function toOverUnderSnapshot(
  snap: OrderedSelectionSnapshot | null,
): OverUnderSnapshot | null {
  if (!snap) return null;
  const over = snap.selections.find((s) => s.key === "over")?.odd;
  const under = snap.selections.find((s) => s.key === "under")?.odd;
  if (over === undefined || under === undefined) return null;
  return {
    bookmaker: snap.bookmaker,
    overOdd: over,
    underOdd: under,
    overroundPct: snap.overroundPct,
    capturedAt: snap.capturedAt,
  };
}

/**
 * Última captura over/under (linha 2.5) na forma binária. BEST-EFFORT (reusa o
 * batch reader que OMITE capturas incoerentes/incompletas em vez de `throw`ar) —
 * mesma semântica não-fatal da `getLatestOddsSnapshot` legada que substitui no
 * contrato de retorno do `ensureOddsSnapshotsFresh`. null se não há captura
 * coerente/completa.
 */
export async function getLatestOverUnderSnapshot(
  matchId: string,
): Promise<OverUnderSnapshot | null> {
  const map = await getLatestOverUnderSnapshotsForMatches([matchId]);
  return map.get(matchId) ?? null;
}

/**
 * Batch read over/under (linha 2.5) na forma binária pra home (evita N+1).
 * Substitui a `getLatestOddsSnapshotsForMatches` legada. Matches sem captura
 * coerente/completa ficam fora do Map.
 */
export async function getLatestOverUnderSnapshotsForMatches(
  matchIds: string[],
): Promise<Map<string, OverUnderSnapshot>> {
  const raw = await getLatestSelectionOddsSnapshotsForMatches(
    matchIds,
    OVER_UNDER_DB_KEY,
    { line: OVER_UNDER_LIVE_LINE },
  );
  const out = new Map<string, OverUnderSnapshot>();
  for (const [matchId, snap] of raw) {
    const adapted = toOverUnderSnapshot(snap);
    if (adapted) out.set(matchId, adapted);
  }
  return out;
}

// Re-export for callers that compose further
export { sql };
