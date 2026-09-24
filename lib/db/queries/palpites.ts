import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  aiCalls,
  matches,
  palpiteOutcomes,
  palpiteSets,
  palpites,
} from "@/db/schema";
import {
  SETTLEABLE_PALPITE_TYPES,
  type SettleablePalpiteType,
} from "@/lib/ai/palpites/settleable";
import { db } from "@/lib/db";
import {
  SETTLEMENT_MIN_ELAPSED_MS,
  type DbAiCall,
  type DbMatch,
} from "@/lib/db/queries/predictions";

export type DbPalpiteSet = typeof palpiteSets.$inferSelect;
export type DbPalpite = typeof palpites.$inferSelect;
export type DbPalpiteOutcome = typeof palpiteOutcomes.$inferSelect;

/**
 * Lê UMA linha de `palpites` por id (ou null). Usada pelo override admin (#394) como
 * guard de existência ANTES do upsert do outcome — sem isso um palpiteId inexistente
 * estouraria a FK de palpite_outcomes como exceção não-tratada (em vez do contrato
 * {ok:false}), divergindo do override de predição.
 */
export async function getPalpiteById(
  palpiteId: string,
): Promise<DbPalpite | null> {
  const [row] = await db
    .select()
    .from(palpites)
    .where(eq(palpites.id, palpiteId))
    .limit(1);
  return row ?? null;
}

export type PalpiteSetWithLines = {
  palpiteSet: DbPalpiteSet;
  // Nullable: aiCallId é NULLABLE em palpite_sets (divergência deliberada vs
  // predictions.aiCallId notNull — o log do ai_call da síntese (#353) pode falhar e
  // ainda produzir um set válido). LEFT join → null quando não há ai_call. A UI trata.
  aiCall: DbAiCall | null;
  // Linhas do set + outcome estreito. `outcome` é null quando a linha não é
  // settleable (red_card/corners) OU ainda não foi liquidada (exact_score
  // pendente). O literal "won" | "lost" é a forma ESTREITA (PLAN §1.4) — void/push
  // nunca alcançam palpite.
  palpites: (DbPalpite & {
    outcome: { result: "won" | "lost" } | null;
  })[];
};

// Linhas + outcome de TODOS os sets numa query BATCHEADA (inArray) — evita N+1
// (uma 2ª query independente do tamanho do histórico). SEAM nomeado extraído de
// getPalpiteSetsForMatch (#372): SQL/ordenação byte-idêntica ao inline anterior —
// pura legibilidade + costura pra um futuro Suspense, sem mudança de comportamento.
// `[]` em entrada vazia (o caller já guarda emptiness antes de chamar, mas a guarda
// torna o helper seguro isolado). orderBy(asc(palpiteSetId), asc(createdAt),
// asc(id)): palpiteSetId agrupa cada set num bloco contíguo; createdAt+id dão ordem
// canônica e determinística DENTRO do bloco. outcomeResult vem do LEFT join (null em
// settleable=false ou ainda-pendente).
async function getPalpiteLinesForSetIds(setIds: string[]) {
  if (setIds.length === 0) return [];
  return db
    .select({ palpite: palpites, outcomeResult: palpiteOutcomes.result })
    .from(palpites)
    .leftJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(inArray(palpites.palpiteSetId, setIds))
    .orderBy(
      asc(palpites.palpiteSetId),
      asc(palpites.createdAt),
      asc(palpites.id)
    );
}

/**
 * Histórico COMPLETO de palpite_sets de um jogo para um usuário, mais recente
 * primeiro — espelha getPredictionHistoryForMatch (lib/db/queries/predictions.ts):
 * escopo por (matchId AND userId) (nunca vaza palpites de outro usuário), ordem
 * newest-first DETERMINÍSTICA via tiebreak desc(id) (a lista inteira é renderizada
 * agora, então um empate de createdAt não pode reordenar entre requests), SEM
 * limit, e as linhas BATCHEADAS via inArray (sem N+1, uma 2ª query independente do
 * tamanho do histórico).
 *
 * Retorna SEMPRE `[]` quando vazio (nunca null). Consumida pela UI (painel interim /
 * HERO do #351).
 */
export async function getPalpiteSetsForMatch(
  matchId: string,
  userId: string
): Promise<PalpiteSetWithLines[]> {
  // Query 1: sets + aiCall. LEFT join — aiCallId nullable → aiCall pode ser null.
  const sets = await db
    .select({ palpiteSet: palpiteSets, aiCall: aiCalls })
    .from(palpiteSets)
    .leftJoin(aiCalls, eq(palpiteSets.aiCallId, aiCalls.id))
    .where(
      and(eq(palpiteSets.matchId, matchId), eq(palpiteSets.userId, userId))
    )
    .orderBy(desc(palpiteSets.createdAt), desc(palpiteSets.id));
  if (sets.length === 0) return [];

  // Query 2 (batcheada, sem N+1): linhas + outcome de TODOS os sets via helper
  // nomeado getPalpiteLinesForSetIds (#372). Depende dos setIds derivados da Query 1
  // (data dependency real: o inArray é construído a partir dos ids retornados), então
  // NÃO é colapsável num Promise.all([q1,q2]) — a concorrência genuína (com a query de
  // predições) já vive no Promise.all da match page.
  const setIds = sets.map((s) => s.palpiteSet.id);
  const lines = await getPalpiteLinesForSetIds(setIds);

  // Agrupa as linhas por palpiteSetId (mesmo padrão de selByPrediction em
  // predictions.ts). `result` da coluna é o pgEnum amplo (won/lost/void/push); o
  // caminho de palpite só EMITE won/lost (PLAN §1.4). Afunilamos por NARROW
  // explícito em runtime (não cast): qualquer coisa fora de won/lost — incluindo
  // null, ou um void/push hipotético de mau-uso futuro do enum — vira outcome null.
  const linesBySet = new Map<string, PalpiteSetWithLines["palpites"]>();
  for (const l of lines) {
    const list = linesBySet.get(l.palpite.palpiteSetId) ?? [];
    list.push({
      ...l.palpite,
      outcome:
        l.outcomeResult === "won" || l.outcomeResult === "lost"
          ? { result: l.outcomeResult }
          : null,
    });
    linesBySet.set(l.palpite.palpiteSetId, list);
  }

  return sets.map((s) => ({
    palpiteSet: s.palpiteSet,
    aiCall: s.aiCall,
    palpites: linesBySet.get(s.palpiteSet.id) ?? [],
  }));
}

/**
 * Lê UM palpite_set público por id (ADR 0035 / #384), com o GATE opt-in
 * `shared_at IS NOT NULL` (NULL = privado, nunca resolvível em /p/[id]). Retorna a
 * MESMA forma `PalpiteSetWithLines` (mapper reusado VERBATIM) + a row crua de `matches`
 * (o loader projeta/gateia downstream — o raw DbMatch NUNCA cruza pro cliente).
 *
 * NÃO escopa por userId/matchId (diferente de getPalpiteSetsForMatch): o link público é
 * resolvível por QUALQUER um — a privacidade é o opt-in `shared_at`, não a sessão. A
 * projeção pública (drop de proveniência) acontece no MAPPER (toPalpiteHeadlineViewFromSet),
 * não aqui.
 */
export async function getSharedPalpiteSet(
  setId: string,
): Promise<{ palpiteSetWithLines: PalpiteSetWithLines; match: DbMatch } | null> {
  // Query 1: o set + aiCall (LEFT, nullable) + a row de matches (INNER — todo set tem
  // jogo). GATE: shared_at IS NOT NULL (opt-in). Sem row → null (set inexistente OU privado).
  const [row] = await db
    .select({ palpiteSet: palpiteSets, aiCall: aiCalls, match: matches })
    .from(palpiteSets)
    .leftJoin(aiCalls, eq(palpiteSets.aiCallId, aiCalls.id))
    .innerJoin(matches, eq(palpiteSets.matchId, matches.id))
    .where(and(eq(palpiteSets.id, setId), isNotNull(palpiteSets.sharedAt)))
    .limit(1);
  if (!row) return null;

  // Query 2 (mesmo helper batcheado): as linhas + outcome do set.
  const lines = await getPalpiteLinesForSetIds([row.palpiteSet.id]);

  // NARROW-not-cast won/lost (VERBATIM de getPalpiteSetsForMatch :115-126): só won/lost
  // alcançam palpite; null/void/push → outcome null.
  const palpitesWithOutcome: PalpiteSetWithLines["palpites"] = lines.map((l) => ({
    ...l.palpite,
    outcome:
      l.outcomeResult === "won" || l.outcomeResult === "lost"
        ? { result: l.outcomeResult }
        : null,
  }));

  return {
    palpiteSetWithLines: {
      palpiteSet: row.palpiteSet,
      aiCall: row.aiCall,
      palpites: palpitesWithOutcome,
    },
    match: row.match,
  };
}

/**
 * Dono + sharedAt de um set por id (ADR 0035 / #384) — SEM o gate shared_at: a share-action
 * checa ownership ANTES de compartilhar E precisa do sharedAt pra pular re-stamp (skip-not-
 * restamp). Retorna null em set inexistente (a action colapsa 404/403 num erro opaco).
 */
export async function getPalpiteSetOwner(
  setId: string,
): Promise<{ userId: string; sharedAt: Date | null } | null> {
  const [row] = await db
    .select({ userId: palpiteSets.userId, sharedAt: palpiteSets.sharedAt })
    .from(palpiteSets)
    .where(eq(palpiteSets.id, setId))
    .limit(1);
  return row ?? null;
}

/**
 * Carimba `shared_at` de um set (ADR 0035 / #384) — o gesto opt-in de compartilhar — ou o
 * LIMPA (`null`, kill-switch do §3e / #438: o set volta a privado e /p/[id] 404a). As
 * actions (shareSet/unshareSet) garantem ownership ANTES de chamar; aqui é só a escrita.
 */
export async function setPalpiteSetSharedAt(
  setId: string,
  at: Date | null,
): Promise<void> {
  await db
    .update(palpiteSets)
    .set({ sharedAt: at })
    .where(eq(palpiteSets.id, setId));
}

export type PendingPalpiteSettlement = {
  palpiteId: string;
  // O tipo settleable da linha — a regra de settlement faz dispatch por ele (#354).
  // NARROW-not-cast: a query filtra por inArray(SETTLEABLE_PALPITE_TYPES), mas o
  // Drizzle não refina o tipo do resultado a partir do predicado runtime → estreitamos
  // explicitamente no .map (igual ao narrow de outcomeResult em getPalpiteSetsForMatch),
  // jogando fora qualquer row cujo type não esteja no set (defense-in-depth, nunca
  // deve acontecer dado o gate SQL).
  type: SettleablePalpiteType;
  params: DbPalpite["params"];
  matchId: string;
  // O DONO do palpite (#394): a extração web-grounded de cartões loga ai_calls
  // (userId/matchId notNull+restrict) e o cron não tem usuário requisitante → cada
  // extração loga sob o id do dono. Já vem do join de palpiteSets (usado no notExists),
  // só não era selecionado.
  userId: string;
  league: DbMatch["league"];
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
};

const SETTLEABLE_TYPE_SET: ReadonlySet<DbPalpite["type"]> = new Set(
  SETTLEABLE_PALPITE_TYPES,
);

// Type-guard sobre a ROW inteira (não só o campo): estreita `type` do enum largo pro
// subconjunto settleable, e o `.filter` propaga a narrowing pro tipo do array — sem
// cast cru (convenção narrow-not-cast do repo).
function rowHasSettleableType<T extends { type: DbPalpite["type"] }>(
  row: T,
): row is T & { type: SettleablePalpiteType } {
  return SETTLEABLE_TYPE_SET.has(row.type);
}

/**
 * Palpites de placar exato ainda aguardando liquidação: sem palpite_outcomes row
 * E o jogo começou há tempo suficiente pra ter um placar de 90'. Espelha
 * getPendingSettlementPredictions (lib/db/queries/predictions.ts) — mesmo cutoff
 * SETTLEMENT_MIN_ELAPSED_MS (importado, NÃO duplicado), mesmo LEFT-join IS NULL
 * (um palpite já liquidado/overridden tem outcome row → excluído).
 *
 * O filtro `type IN SETTLEABLE_PALPITE_TYPES AND settleable=true` é o GATE que honra
 * "prefer skip over silent wrong settle" (ADR 0028 §3): red_card/corners
 * (settleable=false, FORA da tupla) NUNCA entram no pending set, nunca recebem outcome.
 * Gate duplo (type E settleable) — defense-in-depth contra uma escrita errada. A tupla
 * SETTLEABLE_PALPITE_TYPES é a fonte ÚNICA que dirige este predicado E deriveSettleable
 * (#354) — sem drift.
 *
 * LATEST-ONLY (ADR 0030 / #353, blocker #2): cada run do palpite-first grava um
 * `palpite_set` novo (semântica de regen, sets imutáveis newest-first), então um jogo
 * pode ter N sets/usuário. SÓ a ÚLTIMA geração por (matchId,userId) liquida —
 * `notExists` de um set mais novo do mesmo (match,user). Mantém paridade com o display,
 * que já mostra `sets[0]`. Sem isso, N badges/jogo apareceriam.
 */
export async function getPendingPalpiteSettlements(
  now: Date = new Date()
): Promise<PendingPalpiteSettlement[]> {
  const cutoff = new Date(now.getTime() - SETTLEMENT_MIN_ELAPSED_MS);
  const newerSet = alias(palpiteSets, "newer_set");
  const rows = await db
    .select({
      palpiteId: palpites.id,
      type: palpites.type,
      params: palpites.params,
      matchId: matches.id,
      userId: palpiteSets.userId,
      league: matches.league,
      kickoffAt: matches.kickoffAt,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
    })
    .from(palpites)
    .innerJoin(palpiteSets, eq(palpites.palpiteSetId, palpiteSets.id))
    .innerJoin(matches, eq(palpiteSets.matchId, matches.id))
    .leftJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(
      and(
        inArray(palpites.type, SETTLEABLE_PALPITE_TYPES),
        eq(palpites.settleable, true),
        isNull(palpiteOutcomes.id),
        lt(matches.kickoffAt, cutoff),
        // Só a última geração por (matchId,userId): não existe um set mais novo do
        // MESMO match+user. "Mais novo" = createdAt maior, OU createdAt igual e id
        // maior — espelha EXATAMENTE o desc(createdAt), desc(id) do display, então o
        // mesmo set único vence nos dois caminhos mesmo num empate de instante (writes
        // sequenciais quase nunca empatam, mas o tiebreak determinístico fecha a
        // divergência display↔settlement).
        notExists(
          db
            .select({ one: newerSet.id })
            .from(newerSet)
            .where(
              and(
                eq(newerSet.matchId, palpiteSets.matchId),
                eq(newerSet.userId, palpiteSets.userId),
                or(
                  gt(newerSet.createdAt, palpiteSets.createdAt),
                  and(
                    eq(newerSet.createdAt, palpiteSets.createdAt),
                    gt(newerSet.id, palpiteSets.id)
                  )
                )
              )
            )
        )
      )
    )
    .orderBy(desc(matches.kickoffAt));

  // NARROW-not-cast: o predicado inArray garante em runtime que `type` é settleable,
  // mas o Drizzle não refina o tipo do resultado a partir dele. Estreitamos por
  // type-guard sobre a row (filter), descartando qualquer linha fora da tupla (nunca
  // deve acontecer dado o gate SQL — defense-in-depth).
  return rows.filter(rowHasSettleableType);
}
