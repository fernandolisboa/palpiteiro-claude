import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";

import {
  betLegOutcomes,
  betLegs,
  betSlips,
  matches,
  type BetLegParams,
  type PalpiteResultData,
} from "@/db/schema";
import { db } from "@/lib/db";
import { SETTLEMENT_MIN_ELAPSED_MS, type DbMatch } from "@/lib/db/queries/predictions";
import {
  SETTLEABLE_USER_BET_KINDS,
  type BetLegKind,
  type SettleableUserBetKind,
} from "@/lib/settlement/rules/user-bet-dispatch";

export type DbBetSlip = typeof betSlips.$inferSelect;
export type DbBetLeg = typeof betLegs.$inferSelect;
export type DbBetLegOutcome = typeof betLegOutcomes.$inferSelect;

export type GradeSource = DbBetLeg["gradeSource"];
export type GradeStatus = DbBetLeg["gradeStatus"];

// Uma perna JÁ GRADEADA (números congelados) pronta pra persistir no confirm. As
// colunas numeric do Drizzle são strings no DB → stringificamos na fronteira do
// insert (userOdd/modelProbPct), e a leitura re-Number()'a na fronteira de view.
export type NewBetLeg = {
  kind: BetLegKind;
  params: BetLegParams;
  userOdd: number | null;
  modelProbPct: number | null;
  gradeSource: GradeSource;
  gradeStatus: GradeStatus;
  settleable: boolean;
  pinnedPredictionId: string | null;
};

export type NewBetSlip = {
  matchId: string;
  userId: string;
  rawInput: string | null;
  parseAiCallId: string | null;
  comboUserOdd: number | null;
  // Conjunta congelada (0-100) da combinada same-game (#473, Decisão 4). null quando
  // o slip é de perna única OU a combinada não é avaliável (perna fora da matriz/sem
  // grade/standings indisponível). numeric → string no insert.
  jointProbPct: number | null;
  legs: NewBetLeg[];
};

/**
 * Persiste um slip + suas pernas (no confirm — Decisão 5). Insert sequencial (neon-http
 * não tem transação real): slip primeiro (pra o id), pernas depois. O slip só nasce no
 * confirm (parse abandonado não deixa órfão) e é IMUTÁVEL depois — corrigir = novo slip.
 */
export async function insertBetSlipWithLegs(
  slip: NewBetSlip,
): Promise<{ slipId: string; legIds: string[] }> {
  const [slipRow] = await db
    .insert(betSlips)
    .values({
      matchId: slip.matchId,
      userId: slip.userId,
      rawInput: slip.rawInput,
      parseAiCallId: slip.parseAiCallId,
      comboUserOdd:
        slip.comboUserOdd === null ? null : slip.comboUserOdd.toFixed(3),
      jointProbPct:
        slip.jointProbPct === null ? null : slip.jointProbPct.toFixed(2),
    })
    .returning({ id: betSlips.id });
  const slipId = slipRow.id;

  const legRows = await db
    .insert(betLegs)
    .values(
      slip.legs.map((l) => ({
        slipId,
        kind: l.kind,
        params: l.params,
        userOdd: l.userOdd === null ? null : l.userOdd.toFixed(3),
        modelProbPct:
          l.modelProbPct === null ? null : l.modelProbPct.toFixed(2),
        gradeSource: l.gradeSource,
        gradeStatus: l.gradeStatus,
        settleable: l.settleable,
        pinnedPredictionId: l.pinnedPredictionId,
      })),
    )
    .returning({ id: betLegs.id });

  return { slipId, legIds: legRows.map((r) => r.id) };
}

export type InsertBetLegOutcomeArgs = {
  legId: string;
  resultData: PalpiteResultData;
  // won/lost só (linha garantida k+0.5, placar binário — void/push não se aplicam).
  result: "won" | "lost";
};

/**
 * Write idempotente da liquidação de uma perna. `legId` é UNIQUE → um re-run bate no
 * conflito e não faz nada (espelha insertPalpiteOutcomeIfAbsent). Retorna true sse
 * inseriu de fato.
 */
export async function insertBetLegOutcomeIfAbsent(
  args: InsertBetLegOutcomeArgs,
): Promise<boolean> {
  const inserted = await db
    .insert(betLegOutcomes)
    .values({
      legId: args.legId,
      resultData: args.resultData,
      result: args.result,
    })
    .onConflictDoNothing({ target: betLegOutcomes.legId })
    .returning({ id: betLegOutcomes.id });
  return inserted.length > 0;
}

export type PendingUserBetLeg = {
  legId: string;
  // NARROW-not-cast (espelha getPendingPalpiteSettlements): a query filtra por
  // inArray(SETTLEABLE_USER_BET_KINDS), mas o Drizzle não refina o tipo do resultado
  // a partir do predicado runtime → estreitamos no .filter (defense-in-depth).
  kind: SettleableUserBetKind;
  params: DbBetLeg["params"];
  matchId: string;
  league: DbMatch["league"];
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
};

const SETTLEABLE_KIND_SET: ReadonlySet<BetLegKind> = new Set(
  SETTLEABLE_USER_BET_KINDS,
);

function rowHasSettleableKind<T extends { kind: BetLegKind }>(
  row: T,
): row is T & { kind: SettleableUserBetKind } {
  return SETTLEABLE_KIND_SET.has(row.kind);
}

/**
 * Pernas settleable ainda pendentes cujo jogo já começou há tempo de ter um placar
 * de 90'. Espelha getPendingPalpiteSettlements FIELMENTE: mesmo cutoff, LEFT-join IS
 * NULL, gate duplo (kind∈SETTLEABLE_USER_BET_KINDS AND settleable=true). SEM filtro
 * de matches.status na SQL — "finished + regulationScore" é decidido no orquestrador
 * (settle-user-bets) via provider.getFixtureResult, igual a settle-palpites. SEM
 * latest-only: cada slip é independente e imutável (não há semântica de regen).
 */
export async function getPendingUserBetLegSettlements(
  now: Date = new Date(),
): Promise<PendingUserBetLeg[]> {
  const cutoff = new Date(now.getTime() - SETTLEMENT_MIN_ELAPSED_MS);
  const rows = await db
    .select({
      legId: betLegs.id,
      kind: betLegs.kind,
      params: betLegs.params,
      matchId: matches.id,
      league: matches.league,
      kickoffAt: matches.kickoffAt,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
    })
    .from(betLegs)
    .innerJoin(betSlips, eq(betLegs.slipId, betSlips.id))
    .innerJoin(matches, eq(betSlips.matchId, matches.id))
    .leftJoin(betLegOutcomes, eq(betLegOutcomes.legId, betLegs.id))
    .where(
      and(
        inArray(betLegs.kind, SETTLEABLE_USER_BET_KINDS),
        eq(betLegs.settleable, true),
        isNull(betLegOutcomes.id),
        lt(matches.kickoffAt, cutoff),
      ),
    )
    .orderBy(desc(matches.kickoffAt));

  return rows.filter(rowHasSettleableKind);
}

// Leitura pós-confirm: os slips do usuário neste jogo, com pernas e outcome. Alimenta
// o "suas apostas neste jogo" (a Fase 3 troca por histórico paginado cursor).
export type UserBetLegRow = DbBetLeg & { outcome: DbBetLegOutcome | null };
export type UserBetSlipRow = DbBetSlip & { legs: UserBetLegRow[] };

export async function getUserBetSlipsForMatch(
  matchId: string,
  userId: string,
): Promise<UserBetSlipRow[]> {
  const rows = await db
    .select({ slip: betSlips, leg: betLegs, outcome: betLegOutcomes })
    .from(betSlips)
    .innerJoin(betLegs, eq(betLegs.slipId, betSlips.id))
    .leftJoin(betLegOutcomes, eq(betLegOutcomes.legId, betLegs.id))
    .where(and(eq(betSlips.matchId, matchId), eq(betSlips.userId, userId)))
    .orderBy(desc(betSlips.createdAt));

  const bySlip = new Map<string, UserBetSlipRow>();
  for (const r of rows) {
    let slip = bySlip.get(r.slip.id);
    if (!slip) {
      slip = { ...r.slip, legs: [] };
      bySlip.set(r.slip.id, slip);
    }
    slip.legs.push({ ...r.leg, outcome: r.outcome });
  }
  return [...bySlip.values()];
}

// ── Histórico "Minhas apostas" (#473, ADR 0036) ──────────────────────────────
// Status do slip DERIVADO EM LEITURA (nunca coluna denormalizada). PRECEDÊNCIA PINADA
// (Decisão 5, lost domina): (1) alguma perna com outcome `lost` → errou; (2) senão
// alguma perna `settleable=false` → nao_conferida; (3) senão TODA perna com outcome
// `won` → acertou; (4) senão pendente. Perna pendente/não-liquidada tem outcome=null →
// não conta como `won` → nunca falso-acertou (a armadilha do `bool_and` sobre o NULL do
// LEFT JOIN). Função PURA — pglite-testável, sem drift com o render.
export type SlipStatus = "acertou" | "errou" | "pendente" | "nao_conferida";

export function deriveSlipStatus(
  legs: Array<{ settleable: boolean; outcome: { result: string } | null }>,
): SlipStatus {
  if (legs.some((l) => l.outcome?.result === "lost")) return "errou";
  if (legs.some((l) => !l.settleable)) return "nao_conferida";
  if (legs.length > 0 && legs.every((l) => l.outcome?.result === "won"))
    return "acertou";
  return "pendente";
}

export type BetSlipMatch = {
  homeTeam: string;
  awayTeam: string;
  league: DbMatch["league"];
  kickoffAt: Date;
};
export type BetSlipHistoryRow = DbBetSlip & {
  match: BetSlipMatch;
  legs: UserBetLegRow[];
  status: SlipStatus;
};
export type BetSlipsPage = {
  slips: BetSlipHistoryRow[];
  // ISO createdAt do último slip da página quando há mais — passar de volta como cursor.
  nextCursor: string | null;
};

/**
 * Página do histórico de slips do usuário — cursor por `createdAt desc` (+ `id desc` de
 * tiebreak determinístico), ~20 por página. `userId` vem SEMPRE do `auth()` da página
 * (anti-IDOR — nunca de rota/query). Duas queries: (1) slips paginados + join `matches`
 * pro cabeçalho; (2) pernas+outcomes das slip ids da página. Status derivado por
 * `deriveSlipStatus` em leitura. Slip é imutável e privado — nada aqui cruza fronteira
 * pública (`/p/[id]`/OG).
 */
export async function getUserBetSlipsPage(args: {
  userId: string;
  cursor?: Date;
  limit?: number;
}): Promise<BetSlipsPage> {
  const limit = args.limit ?? 20;

  const slipRows = await db
    .select({
      slip: betSlips,
      match: {
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        league: matches.league,
        kickoffAt: matches.kickoffAt,
      },
    })
    .from(betSlips)
    .innerJoin(matches, eq(betSlips.matchId, matches.id))
    .where(
      and(
        eq(betSlips.userId, args.userId),
        args.cursor ? lt(betSlips.createdAt, args.cursor) : undefined,
      ),
    )
    .orderBy(desc(betSlips.createdAt), desc(betSlips.id))
    .limit(limit + 1);

  const hasMore = slipRows.length > limit;
  const pageRows = hasMore ? slipRows.slice(0, limit) : slipRows;
  const ids = pageRows.map((r) => r.slip.id);

  const legRows = ids.length
    ? await db
        .select({ leg: betLegs, outcome: betLegOutcomes })
        .from(betLegs)
        .leftJoin(betLegOutcomes, eq(betLegOutcomes.legId, betLegs.id))
        .where(inArray(betLegs.slipId, ids))
        .orderBy(betLegs.createdAt)
    : [];

  const legsBySlip = new Map<string, UserBetLegRow[]>();
  for (const r of legRows) {
    const list = legsBySlip.get(r.leg.slipId) ?? [];
    list.push({ ...r.leg, outcome: r.outcome });
    legsBySlip.set(r.leg.slipId, list);
  }

  const slips: BetSlipHistoryRow[] = pageRows.map((r) => {
    const legs = legsBySlip.get(r.slip.id) ?? [];
    return { ...r.slip, match: r.match, legs, status: deriveSlipStatus(legs) };
  });

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? last.slip.createdAt.toISOString() : null;
  return { slips, nextCursor };
}
