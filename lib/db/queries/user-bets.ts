import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";

import {
  betLegOutcomes,
  betLegs,
  betSlips,
  matches,
  type BetLegParams,
  type PalpiteResultData,
} from "@/db/schema";
import { db } from "@/lib/db";
import type { LiveStamp } from "@/lib/live/stamp";
import { SETTLEMENT_MIN_ELAPSED_MS, type DbMatch } from "@/lib/db/queries/predictions";
import {
  deriveSlipStatus,
  type SlipLedgerRow,
  type SlipStatus,
} from "@/lib/bets/slip-ledger";
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
  // Cupom (#556). Opcionais: a aposta em texto antiga não os tinha.
  modelSource?: "dixon_coles" | "heuristic" | null;
  referenceOdd?: number | null;
  marketImpliedPct?: number | null;
  stakeUnits?: number | null;
  suggestedStakeUnits?: number | null;
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
  mode?: "simples" | "combinada" | null;
  stakeUnits?: number | null;
  // Registro feito com o jogo rolando (#580, ADR 0060 §6): o carimbo validado
  // (`liveColumns`, lib/live/stamp.ts). Ausente = pré-jogo (CHECK no banco).
  isLive?: boolean;
  liveState?: LiveStamp | null;
  // A base do jogo que avaliou as pernas do modelo de placar (#562); só no pré-jogo.
  modelSnapshotId?: string | null;
  legs: NewBetLeg[];
};

const fixed = (n: number | null | undefined, digits: number): string | null =>
  n === null || n === undefined ? null : n.toFixed(digits);

/**
 * Persiste VÁRIOS slips (o registro do cupom, #556: em "Simples" cada perna é um slip)
 * numa ida só. Os ids são gerados aqui pra que slips e pernas entrem no MESMO
 * `db.batch` — no neon-http é uma transação: ou o registro inteiro entra, ou nada.
 */
export async function insertBetSlipsBatch(
  slips: NewBetSlip[],
): Promise<{ slipIds: string[] }> {
  if (slips.length === 0) return { slipIds: [] };
  const slipIds = slips.map(() => crypto.randomUUID());
  const slipInsert = db.insert(betSlips).values(
    slips.map((slip, i) => ({
      id: slipIds[i],
      matchId: slip.matchId,
      userId: slip.userId,
      rawInput: slip.rawInput,
      parseAiCallId: slip.parseAiCallId,
      comboUserOdd: fixed(slip.comboUserOdd, 3),
      jointProbPct: fixed(slip.jointProbPct, 2),
      mode: slip.mode ?? null,
      stakeUnits: fixed(slip.stakeUnits, 2),
      isLive: slip.isLive ?? false,
      liveState: slip.liveState ?? null,
      modelSnapshotId: slip.modelSnapshotId ?? null,
    })),
  );
  const legInsert = db.insert(betLegs).values(
    slips.flatMap((slip, i) =>
      slip.legs.map((l) => ({
        slipId: slipIds[i],
        kind: l.kind,
        params: l.params,
        userOdd: fixed(l.userOdd, 3),
        modelProbPct: fixed(l.modelProbPct, 2),
        gradeSource: l.gradeSource,
        gradeStatus: l.gradeStatus,
        settleable: l.settleable,
        pinnedPredictionId: l.pinnedPredictionId,
        modelSource: l.modelSource ?? null,
        referenceOdd: fixed(l.referenceOdd, 3),
        marketImpliedPct: fixed(l.marketImpliedPct, 2),
        stakeUnits: fixed(l.stakeUnits, 2),
        suggestedStakeUnits: fixed(l.suggestedStakeUnits, 2),
      })),
    ),
  );
  await db.batch([slipInsert, legInsert]);
  return { slipIds };
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

/**
 * Os slips pedidos por id, só os do usuário (anti-IDOR: `userId` vem SEMPRE do
 * `auth()`; id de outro usuário simplesmente não volta). Na ordem dos `slipIds`, que é
 * a ordem do registro: os slips de um mesmo registro dividem o `createdAt` (#562).
 */
export async function getUserBetSlipsByIds(
  userId: string,
  slipIds: readonly string[],
): Promise<UserBetSlipRow[]> {
  if (slipIds.length === 0) return [];
  const rows = await db
    .select({ slip: betSlips, leg: betLegs, outcome: betLegOutcomes })
    .from(betSlips)
    .innerJoin(betLegs, eq(betLegs.slipId, betSlips.id))
    .leftJoin(betLegOutcomes, eq(betLegOutcomes.legId, betLegs.id))
    .where(and(inArray(betSlips.id, [...slipIds]), eq(betSlips.userId, userId)));

  const bySlip = new Map<string, UserBetSlipRow>();
  for (const r of rows) {
    let slip = bySlip.get(r.slip.id);
    if (!slip) {
      slip = { ...r.slip, legs: [] };
      bySlip.set(r.slip.id, slip);
    }
    slip.legs.push({ ...r.leg, outcome: r.outcome });
  }
  return slipIds.flatMap((id) => {
    const slip = bySlip.get(id);
    return slip ? [slip] : [];
  });
}

// ── Histórico "Minhas apostas" (#473, ADR 0036) ──────────────────────────────
// Status do slip DERIVADO EM LEITURA: a função pura mora em lib/bets/slip-ledger (a
// mesma derivação alimenta o recorte Em aberto/Encerradas e o saldo, #577).
export { deriveSlipStatus, type SlipStatus };

/**
 * Todos os slips do usuário, com as colunas enxutas do resumo de /apostas (#577):
 * modo, stake/odd do slip e das pernas, resultado de cada perna e se o jogo acabou.
 * Uma query (`bet_slips ⨝ matches ⟕ bet_legs ⟕ bet_leg_outcomes`), agrupada em
 * memória. `userId` vem SEMPRE do `auth()` (anti-IDOR). `matchOver` = jogo
 * finished/cancelled OU apitado há mais de SETTLEMENT_MIN_ELAPSED_MS (a mesma janela
 * da liquidação): sem o tempo, uma aposta não conferida ficaria em aberto pra sempre
 * se o cron não virasse o status. Adiado (`postponed`) nunca acaba por tempo.
 */
export async function getUserBetSlipLedger(
  userId: string,
  now: Date = new Date(),
): Promise<SlipLedgerRow[]> {
  const cutoff = now.getTime() - SETTLEMENT_MIN_ELAPSED_MS;
  const rows = await db
    .select({
      slipId: betSlips.id,
      mode: betSlips.mode,
      slipStake: betSlips.stakeUnits,
      comboUserOdd: betSlips.comboUserOdd,
      isLive: betSlips.isLive,
      matchStatus: matches.status,
      kickoffAt: matches.kickoffAt,
      legId: betLegs.id,
      settleable: betLegs.settleable,
      userOdd: betLegs.userOdd,
      legStake: betLegs.stakeUnits,
      result: betLegOutcomes.result,
    })
    .from(betSlips)
    .innerJoin(matches, eq(betSlips.matchId, matches.id))
    .leftJoin(betLegs, eq(betLegs.slipId, betSlips.id))
    .leftJoin(betLegOutcomes, eq(betLegOutcomes.legId, betLegs.id))
    .where(eq(betSlips.userId, userId))
    .orderBy(desc(betSlips.createdAt), desc(betSlips.id), betLegs.createdAt);

  const bySlip = new Map<string, SlipLedgerRow>();
  for (const r of rows) {
    let slip = bySlip.get(r.slipId);
    if (!slip) {
      slip = {
        id: r.slipId,
        mode: r.mode,
        stakeUnits: r.slipStake,
        comboUserOdd: r.comboUserOdd,
        matchStatus: r.matchStatus,
        // Adiado não acaba por tempo: o jogo ainda pode ser jogado (fica em aberto).
        matchOver:
          r.matchStatus === "finished" ||
          r.matchStatus === "cancelled" ||
          (r.matchStatus !== "postponed" && r.kickoffAt.getTime() < cutoff),
        isLive: r.isLive,
        legs: [],
      };
      bySlip.set(r.slipId, slip);
    }
    if (r.legId !== null && r.settleable !== null) {
      slip.legs.push({
        settleable: r.settleable,
        userOdd: r.userOdd,
        stakeUnits: r.legStake,
        outcome: r.result === null ? null : { result: r.result },
      });
    }
  }
  return [...bySlip.values()];
}

export type BetSlipMatch = {
  homeTeam: string;
  awayTeam: string;
  league: DbMatch["league"];
  kickoffAt: Date;
  status: DbMatch["status"];
};
export type BetSlipHistoryRow = DbBetSlip & {
  match: BetSlipMatch;
  legs: UserBetLegRow[];
  status: SlipStatus;
};
export type BetSlipsPage = {
  slips: BetSlipHistoryRow[];
  // Cursor OPACO (`<iso createdAt>|<id>`) do último slip da página quando há mais.
  nextCursor: string | null;
};

// Keyset COMPOSTO (createdAt, id): sem carregar o `id`, dois slips no MESMO `createdAt`
// seriam pulados no limite da página (o `desc(id)` do ORDER BY ficaria inerte). Cursor
// opaco pra não expor a forma; decode tolerante (cursor inválido = primeira página).
function encodeSlipCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}
function decodeSlipCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  const idx = cursor.lastIndexOf("|");
  if (idx <= 0) return null;
  const createdAt = new Date(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
  return { createdAt, id };
}

/**
 * Página do histórico de slips do usuário — keyset COMPOSTO por `(createdAt, id) desc`,
 * ~20 por página. `userId` vem SEMPRE do `auth()` da página (anti-IDOR — nunca de rota/
 * query). Duas queries: (1) slips paginados + join `matches` pro cabeçalho; (2) pernas+
 * outcomes das slip ids da página. Status derivado por `deriveSlipStatus` em leitura.
 * Slip é imutável e privado — nada aqui cruza fronteira pública (`/p/[id]`/OG).
 */
export async function getUserBetSlipsPage(args: {
  userId: string;
  cursor?: string;
  limit?: number;
  // Recorte (#577, Em aberto/Encerradas): só estes slips. O keyset não muda, então o
  // cursor vale dentro do recorte. Lista vazia → página vazia sem ir ao banco. Um
  // parâmetro por id: ok pra centenas/poucos milhares de slips por usuário (teto do
  // Postgres: 65.535). Acima disso, trocar por EXISTS espelhando `slipBucket`.
  slipIds?: readonly string[];
}): Promise<BetSlipsPage> {
  if (args.slipIds && args.slipIds.length === 0) {
    return { slips: [], nextCursor: null };
  }
  const limit = args.limit ?? 20;
  const cur = args.cursor ? decodeSlipCursor(args.cursor) : null;

  const slipRows = await db
    .select({
      slip: betSlips,
      match: {
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        league: matches.league,
        kickoffAt: matches.kickoffAt,
        status: matches.status,
      },
    })
    .from(betSlips)
    .innerJoin(matches, eq(betSlips.matchId, matches.id))
    .where(
      and(
        eq(betSlips.userId, args.userId),
        args.slipIds ? inArray(betSlips.id, [...args.slipIds]) : undefined,
        cur
          ? or(
              lt(betSlips.createdAt, cur.createdAt),
              and(
                eq(betSlips.createdAt, cur.createdAt),
                lt(betSlips.id, cur.id),
              ),
            )
          : undefined,
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
  const nextCursor =
    hasMore && last ? encodeSlipCursor(last.slip.createdAt, last.slip.id) : null;
  return { slips, nextCursor };
}
