import { eq } from "drizzle-orm";

import { marketSelections, markets } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Catálogo resolvido de UM mercado: `markets.id` + os mapas bidirecionais
 * (selectionKey ↔ selectionId) das suas `market_selections`.
 *
 *   - `idByKey`: `'over' → sel-uuid` (usado por predict.ts pra `selection_id` e
 *     pela ingestão de odds pra montar as rows da tabela genérica).
 *   - `keyById`: `sel-uuid → 'over'` (usado pela leitura de snapshots pra mapear
 *     uma row de volta pra sua chave).
 */
export type MarketCatalog = {
  marketId: string;
  idByKey: Map<string, string>;
  keyById: Map<string, string>;
};

/**
 * Resolver canônico do catálogo de um `dbMarketKey` (`'over_under'`,
 * `'match_result'`). UMA query de `markets` + UMA de `market_selections`; cache
 * por chamada (cada caller invoca uma vez no bloco de reads).
 *
 * Hard-fail se o catálogo não tiver o mercado ou nenhuma seleção (estilo `selIdOf`
 * do backfill) — um catálogo incompleto é bug de seed, não algo a degradar. Roda
 * SEMPRE antes de qualquer escrita/chamada paga, então a falha não queima spend
 * nem viola FK opaca pós-fato.
 */
export async function resolveMarketCatalog(
  dbMarketKey: string,
): Promise<MarketCatalog> {
  const [mkt] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.key, dbMarketKey))
    .limit(1);
  if (!mkt) {
    throw new Error(`market '${dbMarketKey}' não encontrado no catálogo`);
  }
  const sels = await db
    .select({ id: marketSelections.id, key: marketSelections.key })
    .from(marketSelections)
    .where(eq(marketSelections.marketId, mkt.id));
  if (sels.length === 0) {
    throw new Error(`market '${dbMarketKey}' sem seleções no catálogo`);
  }
  return {
    marketId: mkt.id,
    idByKey: new Map(sels.map((s) => [s.key, s.id])),
    keyById: new Map(sels.map((s) => [s.id, s.key])),
  };
}
