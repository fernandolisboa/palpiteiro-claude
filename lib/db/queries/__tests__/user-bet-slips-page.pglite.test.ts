// @vitest-environment node
//
// Histórico "Minhas apostas" (#473, ADR 0036 Fase 3) contra Postgres REAL via pglite.
// Cobre: paginação cursor por createdAt desc (~20/página, nextCursor), scoping por
// userId (anti-IDOR — só os slips do dono), status derivado em leitura (acertou/errou/
// pendente/nao_conferida) e a precedência PINADA (lost domina; pendente NUNCA vira
// falso-acertou). Espelha settle-user-bets.pglite.test.ts. Roda em `node`.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { slipBucket } from "@/lib/bets/slip-ledger";
import { buildLiveStamp, readLiveStamp } from "@/lib/live/stamp";

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (realDb as any)[prop];
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    },
  ),
}));

import {
  deriveSlipStatus,
  getUserBetSlipLedger,
  getUserBetSlipsPage,
} from "@/lib/db/queries/user-bets";

const ids: { userId: string; otherUserId: string } = {} as never;
const KICKOFF = new Date("2026-05-15T19:00:00Z");

async function seedMatch(
  externalId: string,
  opts: {
    status?: (typeof schema.matchStatusEnum.enumValues)[number];
    kickoffAt?: Date;
  } = {},
): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId,
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: opts.kickoffAt ?? KICKOFF,
      status: opts.status ?? "scheduled",
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

async function seedSlip(args: {
  matchId: string;
  userId: string;
  createdAt?: Date;
  comboUserOdd?: string | null;
  jointProbPct?: string | null;
  mode?: "simples" | "combinada" | null;
  stakeUnits?: string | null;
  isLive?: boolean;
}): Promise<string> {
  const [s] = await realDb
    .insert(schema.betSlips)
    .values({
      matchId: args.matchId,
      userId: args.userId,
      rawInput: "teste",
      parseAiCallId: null,
      comboUserOdd: args.comboUserOdd ?? null,
      jointProbPct: args.jointProbPct ?? null,
      mode: args.mode ?? null,
      stakeUnits: args.stakeUnits ?? null,
      ...(args.isLive
        ? {
            isLive: true,
            liveState: buildLiveStamp({
              source: "api_football",
              status: "2H",
              elapsed: 63,
              extra: null,
              minuteLabel: "63'",
              score: { home: 1, away: 0 },
              red: null,
              fetchedAt: new Date("2026-05-20T11:00:00Z"),
              recordedAt: new Date("2026-05-20T11:00:20Z"),
            }),
          }
        : {}),
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .returning({ id: schema.betSlips.id });
  return s.id;
}

async function seedLeg(args: {
  slipId: string;
  kind?: (typeof schema.betLegKindEnum.enumValues)[number];
  params: schema.BetLegParams;
  settleable?: boolean;
  result?: "won" | "lost";
  stakeUnits?: string | null;
}): Promise<string> {
  const [l] = await realDb
    .insert(schema.betLegs)
    .values({
      slipId: args.slipId,
      kind: args.kind ?? "match_result",
      params: args.params,
      userOdd: "2.000",
      modelProbPct: "50.00",
      gradeSource: "scoreline_model",
      gradeStatus: "graded",
      settleable: args.settleable ?? true,
      stakeUnits: args.stakeUnits ?? null,
    })
    .returning({ id: schema.betLegs.id });
  if (args.result) {
    await realDb.insert(schema.betLegOutcomes).values({
      legId: l.id,
      result: args.result,
      resultData: { homeScore: 1, awayScore: 0, totalGoals: 1 },
    });
  }
  return l.id;
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "bet-hist@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [o] = await base
    .insert(schema.users)
    .values({ email: "other@example.com" })
    .returning({ id: schema.users.id });
  ids.otherUserId = o.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.betLegOutcomes);
  await realDb.delete(schema.betLegs);
  await realDb.delete(schema.betSlips);
  await realDb.delete(schema.matches);
});

describe("deriveSlipStatus — precedência PINADA (lost domina)", () => {
  const won = { settleable: true, outcome: { result: "won" } };
  const lost = { settleable: true, outcome: { result: "lost" } };
  const pending = { settleable: true, outcome: null };
  const naoConferivel = { settleable: false, outcome: null };

  it("alguma lost → errou (mesmo com pernas não-conferíveis)", () => {
    expect(deriveSlipStatus([lost, naoConferivel])).toBe("errou");
    expect(deriveSlipStatus([won, lost])).toBe("errou");
  });
  it("alguma não-settleable (sem lost) → nao_conferida", () => {
    expect(deriveSlipStatus([won, naoConferivel])).toBe("nao_conferida");
  });
  it("TODA perna won → acertou", () => {
    expect(deriveSlipStatus([won, won])).toBe("acertou");
  });
  it("won + pendente → pendente (NUNCA falso-acertou — armadilha do NULL)", () => {
    expect(deriveSlipStatus([won, pending])).toBe("pendente");
  });
  it("slip vazio → pendente (nunca acertou por vacuidade)", () => {
    expect(deriveSlipStatus([])).toBe("pendente");
  });
});

describe("getUserBetSlipsPage — histórico paginado", () => {
  it("scoping por userId: só os slips do dono (anti-IDOR)", async () => {
    const matchId = await seedMatch("ext-scope");
    const mine = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: mine, params: { selection: "home" } });
    const theirs = await seedSlip({ matchId, userId: ids.otherUserId });
    await seedLeg({ slipId: theirs, params: { selection: "away" } });

    const page = await getUserBetSlipsPage({ userId: ids.userId });
    expect(page.slips.map((s) => s.id)).toEqual([mine]);
  });

  it("status derivado por slip (won/lost → acertou/errou/pendente)", async () => {
    const matchId = await seedMatch("ext-status");
    const acertou = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: acertou, params: { selection: "home" }, result: "won" });
    const errou = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: errou, params: { selection: "home" }, result: "won" });
    await seedLeg({ slipId: errou, params: { selection: "away" }, result: "lost" });
    const pendente = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: pendente, params: { selection: "home" }, result: "won" });
    await seedLeg({ slipId: pendente, params: { selection: "away" } });

    const page = await getUserBetSlipsPage({ userId: ids.userId });
    const byId = new Map(page.slips.map((s) => [s.id, s.status]));
    expect(byId.get(acertou)).toBe("acertou");
    expect(byId.get(errou)).toBe("errou");
    expect(byId.get(pendente)).toBe("pendente");
  });

  it("perna não-settleable → nao_conferida", async () => {
    const matchId = await seedMatch("ext-nc");
    const slip = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: slip, params: { selection: "home" }, result: "won" });
    await seedLeg({
      slipId: slip,
      kind: "corners",
      params: { selection: "over", line: 8.5 },
      settleable: false,
    });
    const page = await getUserBetSlipsPage({ userId: ids.userId });
    expect(page.slips[0].status).toBe("nao_conferida");
  });

  it("paginação cursor: createdAt desc, nextCursor, sem overlap entre páginas", async () => {
    const matchId = await seedMatch("ext-page");
    // 5 slips, createdAt crescente → esperado desc na leitura.
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const slip = await seedSlip({
        matchId,
        userId: ids.userId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      });
      await seedLeg({ slipId: slip, params: { selection: "home" } });
      created.push(slip);
    }
    const expectedDesc = [...created].reverse();

    const p1 = await getUserBetSlipsPage({ userId: ids.userId, limit: 2 });
    expect(p1.slips.map((s) => s.id)).toEqual(expectedDesc.slice(0, 2));
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await getUserBetSlipsPage({
      userId: ids.userId,
      limit: 2,
      cursor: p1.nextCursor!,
    });
    expect(p2.slips.map((s) => s.id)).toEqual(expectedDesc.slice(2, 4));

    const p3 = await getUserBetSlipsPage({
      userId: ids.userId,
      limit: 2,
      cursor: p2.nextCursor!,
    });
    expect(p3.slips.map((s) => s.id)).toEqual(expectedDesc.slice(4, 5));
    expect(p3.nextCursor).toBeNull();
  });

  it("keyset composto: slips no MESMO createdAt não são pulados no limite da página", async () => {
    const matchId = await seedMatch("ext-tie");
    const sameInstant = new Date(Date.UTC(2026, 2, 3, 12, 0, 0));
    const slipIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const slip = await seedSlip({
        matchId,
        userId: ids.userId,
        createdAt: sameInstant,
      });
      await seedLeg({ slipId: slip, params: { selection: "home" } });
      slipIds.push(slip);
    }

    // Pagina de 2 em 2 sobre o mesmo instante: a união das duas páginas cobre os 4
    // sem overlap nem buraco (o `id desc` do keyset desempata deterministicamente).
    const p1 = await getUserBetSlipsPage({ userId: ids.userId, limit: 2 });
    const p2 = await getUserBetSlipsPage({
      userId: ids.userId,
      limit: 2,
      cursor: p1.nextCursor!,
    });
    const seen = [...p1.slips, ...p2.slips].map((s) => s.id);
    expect(new Set(seen).size).toBe(4);
    expect([...seen].sort()).toEqual([...slipIds].sort());
    expect(p2.nextCursor).toBeNull();
  });

  it("carrega match + comboUserOdd + legs por slip", async () => {
    const matchId = await seedMatch("ext-shape");
    const slip = await seedSlip({
      matchId,
      userId: ids.userId,
      comboUserOdd: "2.100",
      jointProbPct: "45.00",
    });
    await seedLeg({ slipId: slip, params: { selection: "home" } });
    await seedLeg({
      slipId: slip,
      kind: "over_under",
      params: { selection: "over", line: 1.5 },
    });

    const page = await getUserBetSlipsPage({ userId: ids.userId });
    const row = page.slips[0];
    expect(row.match.homeTeam).toBe("CR Flamengo");
    expect(row.match.awayTeam).toBe("Fluminense FC");
    expect(row.legs).toHaveLength(2);
    expect(Number(row.comboUserOdd)).toBeCloseTo(2.1, 9);
  });
});

describe("getUserBetSlipsPage — recorte por slipIds (#577)", () => {
  it("só os slips do recorte, com o cursor valendo dentro dele", async () => {
    const matchId = await seedMatch("ext-slice");
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const slip = await seedSlip({
        matchId,
        userId: ids.userId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      });
      await seedLeg({ slipId: slip, params: { selection: "home" } });
      created.push(slip);
    }
    // Recorte: 0, 2 e 4 → desc: 4, 2, 0.
    const slice = [created[0], created[2], created[4]];
    const p1 = await getUserBetSlipsPage({ userId: ids.userId, limit: 2, slipIds: slice });
    expect(p1.slips.map((s) => s.id)).toEqual([created[4], created[2]]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await getUserBetSlipsPage({
      userId: ids.userId,
      limit: 2,
      slipIds: slice,
      cursor: p1.nextCursor ?? undefined,
    });
    expect(p2.slips.map((s) => s.id)).toEqual([created[0]]);
    expect(p2.nextCursor).toBeNull();
  });

  it("recorte vazio → página vazia sem ir ao banco", async () => {
    const matchId = await seedMatch("ext-empty-slice");
    const slip = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: slip, params: { selection: "home" } });
    const select = vi.spyOn(realDb, "select");
    try {
      expect(await getUserBetSlipsPage({ userId: ids.userId, slipIds: [] })).toEqual({
        slips: [],
        nextCursor: null,
      });
      expect(select).not.toHaveBeenCalled();
      // O espião enxerga o caminho normal (senão o "not called" acima não prova nada).
      await getUserBetSlipsPage({ userId: ids.userId, slipIds: [slip] });
      expect(select).toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
  });

  it("recorte não vaza slip de outro usuário", async () => {
    const matchId = await seedMatch("ext-slice-idor");
    const theirs = await seedSlip({ matchId, userId: ids.otherUserId });
    await seedLeg({ slipId: theirs, params: { selection: "home" } });
    const page = await getUserBetSlipsPage({ userId: ids.userId, slipIds: [theirs] });
    expect(page.slips).toEqual([]);
  });

  it("traz o status do jogo", async () => {
    const matchId = await seedMatch("ext-status-match", { status: "cancelled" });
    const slip = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: slip, params: { selection: "home" } });
    const page = await getUserBetSlipsPage({ userId: ids.userId });
    expect(page.slips[0].match.status).toBe("cancelled");
  });
});

describe("getUserBetSlipLedger (#577)", () => {
  const NOW = new Date("2026-05-20T12:00:00Z");

  it("perna sem outcome vem com outcome null; stake/odd/modo do slip e da perna", async () => {
    const matchId = await seedMatch("ext-ledger-shape", {
      kickoffAt: new Date("2026-05-21T19:00:00Z"),
    });
    const combo = await seedSlip({
      matchId,
      userId: ids.userId,
      mode: "combinada",
      stakeUnits: "0.50",
      comboUserOdd: "4.260",
    });
    await seedLeg({ slipId: combo, params: { selection: "home" }, result: "won" });
    await seedLeg({ slipId: combo, kind: "btts", params: { selection: "yes" } });

    const [row] = await getUserBetSlipLedger(ids.userId, NOW);
    expect(row.id).toBe(combo);
    expect(row.mode).toBe("combinada");
    expect(Number(row.stakeUnits)).toBe(0.5);
    expect(Number(row.comboUserOdd)).toBeCloseTo(4.26, 9);
    expect(row.matchStatus).toBe("scheduled");
    expect(row.matchOver).toBe(false);
    expect(row.legs.map((l) => l.outcome)).toEqual([{ result: "won" }, null]);
    expect(row.legs.every((l) => l.settleable)).toBe(true);
  });

  it("matchOver por status (finished/cancelled) e por kickoff antigo com status scheduled", async () => {
    const finished = await seedMatch("ext-l-fin", {
      status: "finished",
      kickoffAt: new Date("2026-05-20T11:00:00Z"),
    });
    const cancelled = await seedMatch("ext-l-can", {
      status: "cancelled",
      kickoffAt: new Date("2026-05-21T19:00:00Z"),
    });
    const stale = await seedMatch("ext-l-stale", { kickoffAt: new Date("2026-05-20T09:00:00Z") });
    const recent = await seedMatch("ext-l-recent", { kickoffAt: new Date("2026-05-20T10:00:00Z") });
    const matchBySlip = new Map<string, string>();
    for (const m of [finished, cancelled, stale, recent]) {
      const slip = await seedSlip({ matchId: m, userId: ids.userId });
      await seedLeg({ slipId: slip, params: { selection: "home" }, stakeUnits: "1.00" });
      matchBySlip.set(slip, m);
    }
    const rows = await getUserBetSlipLedger(ids.userId, NOW);
    const over = new Map(rows.map((r) => [matchBySlip.get(r.id), r.matchOver]));
    expect(over.get(finished)).toBe(true);
    expect(over.get(cancelled)).toBe(true);
    // 3h antes de NOW (> 150 min) → acabou; 2h antes (< 150 min) → ainda não.
    expect(over.get(stale)).toBe(true);
    expect(over.get(recent)).toBe(false);
    expect(rows.every((r) => Number(r.legs[0].stakeUnits) === 1)).toBe(true);
  });

  it("isLive do slip (#580): o resumo separa as ao vivo", async () => {
    const matchId = await seedMatch("ext-l-live", {
      kickoffAt: new Date("2026-05-20T10:00:00Z"),
    });
    const pre = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: pre, params: { selection: "home" } });
    const live = await seedSlip({ matchId, userId: ids.userId, isLive: true });
    await seedLeg({ slipId: live, params: { selection: "home" } });
    const rows = await getUserBetSlipLedger(ids.userId, NOW);
    const byId = new Map(rows.map((r) => [r.id, r.isLive]));
    expect(byId.get(pre)).toBe(false);
    expect(byId.get(live)).toBe(true);
    const page = await getUserBetSlipsPage({ userId: ids.userId });
    const liveRow = page.slips.find((sl) => sl.id === live);
    expect(liveRow?.isLive).toBe(true);
    expect(readLiveStamp(liveRow?.liveState)?.minuteLabel).toBe("63'");
  });

  it("jogo adiado não acaba por tempo: não conferida segue em aberto", async () => {
    const postponed = await seedMatch("ext-l-post", {
      status: "postponed",
      kickoffAt: new Date("2026-05-20T09:00:00Z"),
    });
    const slip = await seedSlip({ matchId: postponed, userId: ids.userId });
    await seedLeg({
      slipId: slip,
      kind: "corners",
      params: { selection: "over", line: 8.5 },
      settleable: false,
    });
    const [row] = await getUserBetSlipLedger(ids.userId, NOW);
    expect(row.matchStatus).toBe("postponed");
    // Kickoff 3h antes de NOW (> 150 min), mas adiado: não acabou.
    expect(row.matchOver).toBe(false);
    expect(slipBucket(row)).toBe("open");
  });

  it("não vaza slip de outro usuário", async () => {
    const matchId = await seedMatch("ext-l-idor");
    const mine = await seedSlip({ matchId, userId: ids.userId });
    await seedLeg({ slipId: mine, params: { selection: "home" } });
    const theirs = await seedSlip({ matchId, userId: ids.otherUserId });
    await seedLeg({ slipId: theirs, params: { selection: "away" } });
    const rows = await getUserBetSlipLedger(ids.userId, NOW);
    expect(rows.map((r) => r.id)).toEqual([mine]);
  });
});
