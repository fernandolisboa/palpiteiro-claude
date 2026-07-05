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
  getUserBetSlipsPage,
} from "@/lib/db/queries/user-bets";

const ids: { userId: string; otherUserId: string } = {} as never;
const KICKOFF = new Date("2026-05-15T19:00:00Z");

async function seedMatch(externalId: string): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId,
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: KICKOFF,
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
