import { and, asc, eq, sql } from "drizzle-orm";

import { marketSelections, markets } from "@/db/schema";
import { db } from "@/lib/db";
import { ALL_DESCRIPTORS } from "@/lib/odds/market-descriptor";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

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

/**
 * Resolve SÓ a row `markets` de um dbMarketKey (sem ler market_selections) — pra
 * mercados `dynamicSelections` (#290), cujas seleções não existem até crescerem
 * lazily. SEPARADO de `resolveMarketCatalog` de PROPÓSITO: o reader genérico
 * hard-falha em ZERO seleções (market-catalog:48-50), o que é correto pra mercados
 * estáticos (seed incompleto = bug) mas FATAL pra um mercado scorer recém-seedado
 * (0 jogadores até a 1ª análise). Hard-fail só no mercado ausente.
 */
export async function resolveMarketRow(
  dbMarketKey: string,
): Promise<{ marketId: string }> {
  const [mkt] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.key, dbMarketKey))
    .limit(1);
  if (!mkt) {
    throw new Error(`market '${dbMarketKey}' não encontrado no catálogo`);
  }
  return { marketId: mkt.id };
}

/**
 * Materializa LAZY as `market_selections` de um mercado `dynamicSelections`
 * (#290 scorer/assist): um jogador por seleção, chave `scorer_<slug>`/`assist_<slug>`
 * + o NOME no `label` (coluna NOT NULL — sem ele a view renderiza a key crua ou
 * crasha em getMarketPresentation).
 *
 * Upsert IDEMPOTENTE via `onConflictDoNothing` no UNIQUE(market_id, key) existente
 * — uma re-análise do mesmo jogo não duplica linhas e uma corrida concorrente é
 * fechada pelo UNIQUE + re-read. Roda PRÉ-chamada-paga no predict (uma falha de DB
 * nunca queima spend). Retorna `idByKey` (key → selectionId) RE-LIDO do banco após
 * o upsert (pega tanto as linhas novas quanto as pré-existentes da corrida).
 *
 * NUNCA re-entra em `resolveMarketCatalog` (que assere completude/zero-seleção).
 */
export async function ensureScorerSelections(
  marketId: string,
  players: { key: string; label: string }[],
): Promise<{ idByKey: Map<string, string> }> {
  // Dedup por key em memória (o bundle de odds já dedup, mas defensivo) — evita
  // VALUES com a mesma key na mesma sentença.
  const byKey = new Map<string, string>();
  for (const p of players) {
    if (!byKey.has(p.key)) byKey.set(p.key, p.label);
  }
  const rows = [...byKey.entries()].map(([key, label]) => ({
    marketId,
    key,
    label,
  }));
  if (rows.length > 0) {
    await db
      .insert(marketSelections)
      .values(rows)
      .onConflictDoNothing({
        target: [marketSelections.marketId, marketSelections.key],
      });
  }
  // Re-read: pega linhas novas + pré-existentes (corrida concorrente). Escopado ao
  // mercado; idByKey alimenta selectionId/PSO no predict.
  const sels = await db
    .select({ id: marketSelections.id, key: marketSelections.key })
    .from(marketSelections)
    .where(eq(marketSelections.marketId, marketId));
  return { idByKey: new Map(sels.map((s) => [s.key, s.id])) };
}

/**
 * Mercado selecionável por uma AUDIÊNCIA (gate de ativação, ADR 0017). Espelha
 * `modelsForAudience` (lib/ai/models.ts), mas a fonte é a tabela `markets` (não um
 * registry em código): a graduação de um mercado é flip de `is_graduated=true` no
 * banco — SEM mudança de código.
 *
 *   - usuário comum → só mercados GRADUADOS (`is_active AND is_graduated`) =
 *     over/under hoje.
 *   - admin → também os ATIVOS-mas-não-graduados (`is_active AND NOT is_graduated`)
 *     = match_result (1X2) hoje.
 *
 * Este é o gate de DEFESA-EM-PROFUNDIDADE pro `marketKey` que viaja no FormData:
 * a UI esconde/limita o seletor, mas a action re-valida contra esta lista (um POST
 * forjado com `marketKey=match_result` de um não-admin é rejeitado/coercido). NUNCA
 * gateado em predict.ts (ADR 0017) — lá o throw-on-unregistered-cartridge é o backstop.
 *
 * Ordenado com `over_under` primeiro (default sensato), depois alfabético por key —
 * estável e independente da ordem de inserção das rows.
 */
export async function marketsForAudience(
  isAdmin: boolean,
): Promise<{ key: string; label: string }[]> {
  // Admin: ativos (graduados OU não). Comum: só graduados.
  const visibility = isAdmin
    ? eq(markets.isActive, true)
    : and(eq(markets.isActive, true), eq(markets.isGraduated, true));
  const rows = await db
    .select({ key: markets.key, label: markets.label })
    .from(markets)
    .where(visibility)
    // over_under primeiro (0 vs 1), depois alfabético por key — determinístico.
    .orderBy(
      asc(sql`case when ${markets.key} = 'over_under' then 0 else 1 end`),
      asc(markets.key),
    );
  return rows;
}

// Allowlist de cobertura de odds por mercado (descriptor.coveredLeagues), indexada
// por dbMarketKey. `undefined` = coberto em TODAS as ligas (over_under/match_result).
const COVERED_LEAGUES_BY_MARKET = new Map<
  string,
  readonly SupportedLeague[] | undefined
>(ALL_DESCRIPTORS.map((d) => [d.dbMarketKey, d.coveredLeagues]));

/**
 * Filtra mercados pela COBERTURA de odds por liga (#158, ADR 0015). Compõe DEPOIS
 * de `marketsForAudience` (não muda a assinatura dela): audiência ∩ liga. Um mercado
 * com `coveredLeagues` (ex.: btts → ['world_cup']) só passa se `league` estiver na
 * allowlist; mercados SEM allowlist (over_under/match_result) passam em TODA liga
 * (pass-through — paridade). Data-driven pelo descriptor, nunca `if (market==='btts')`.
 *
 * Aplicado na page (esconde o seletor) E em analyzeMatch (a FRONTEIRA DE SEGURANÇA:
 * um POST forjado com `marketKey=btts` numa liga sem cobertura é coercido a over_under
 * ANTES da chamada paga). Adicionar uma liga coberta depois = editar `coveredLeagues`
 * no descriptor (1 linha), sem migration.
 *
 * FAIL-CLOSED (#174 code review): um mercado SEM descriptor em ALL_DESCRIPTORS é
 * DROPADO (não pass-through). Sem descriptor não há como resolver odds — ofertá-lo
 * seria um drift silencioso (DB seedou um mercado sem o código correspondente).
 * `has()` distingue "descriptor presente, cobertura universal" (coveredLeagues
 * undefined → passa) de "sem descriptor" (drop).
 */
export function marketsForLeague<T extends { key: string }>(
  marketsList: T[],
  league: SupportedLeague,
): T[] {
  return marketsList.filter((m) => {
    if (!COVERED_LEAGUES_BY_MARKET.has(m.key)) return false; // sem descriptor → fail-closed
    const covered = COVERED_LEAGUES_BY_MARKET.get(m.key);
    return covered === undefined || covered.includes(league);
  });
}
