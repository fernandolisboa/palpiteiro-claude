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
