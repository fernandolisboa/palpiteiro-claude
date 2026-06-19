// @vitest-environment node
//
// getPendingPalpiteSettlements LATEST-ONLY (ADR 0030 / #353, blocker #2) contra
// Postgres REAL via pglite. Cada run do palpite-first grava um set novo → N sets/jogo;
// SÓ a última geração por (matchId,userId) deve liquidar (senão N badges/jogo). Roda
// em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

import type { DbPalpite } from "@/lib/db/queries/palpites";
import { getPendingPalpiteSettlements } from "@/lib/db/queries/palpites";

const ids: { userId: string; otherUserId: string } = {} as never;

// kickoff bem no passado pra cair sempre dentro do cutoff (kickoff < now - 150min).
const KICKOFF = new Date("2026-05-15T19:00:00Z");
const NOW = new Date("2026-05-16T00:00:00Z");

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

// Semeia um set + 1 linha exact_score settleable; createdAt explícito p/ ordenar gerações.
async function seedSetWithScore(args: {
  matchId: string;
  userId: string;
  createdAt: Date;
  params: { home: number; away: number };
}): Promise<{ setId: string; palpiteId: string }> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: args.matchId,
      userId: args.userId,
      aiCallId: null,
      modelVersion: "claude-haiku-4-5",
      promptVersion: "palpites_v3",
      createdAt: args.createdAt,
    })
    .returning({ id: schema.palpiteSets.id });
  const [p] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: s.id,
      type: "exact_score",
      text: "stub",
      params: args.params,
      settleable: true,
    })
    .returning({ id: schema.palpites.id });
  return { setId: s.id, palpiteId: p.id };
}

// #354: semeia um set com N linhas (tipo + params + settleable), espelhando a geração
// multi-row. Devolve o setId + os palpiteIds por tipo.
type SeedLine = {
  type: (typeof schema.palpiteTypeEnum.enumValues)[number];
  params: DbPalpite["params"] | null;
  settleable: boolean;
};

async function seedSetWithLines(args: {
  matchId: string;
  userId: string;
  createdAt: Date;
  lines: SeedLine[];
}): Promise<{ setId: string; palpiteIds: Record<string, string> }> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: args.matchId,
      userId: args.userId,
      aiCallId: null,
      modelVersion: "claude-haiku-4-5",
      promptVersion: "palpites_v3",
      createdAt: args.createdAt,
    })
    .returning({ id: schema.palpiteSets.id });
  const palpiteIds: Record<string, string> = {};
  for (const l of args.lines) {
    const [p] = await realDb
      .insert(schema.palpites)
      .values({
        palpiteSetId: s.id,
        type: l.type,
        text: "stub",
        params: l.params,
        settleable: l.settleable,
      })
      .returning({ id: schema.palpites.id });
    palpiteIds[l.type] = p.id;
  }
  return { setId: s.id, palpiteIds };
}

// As 5 dimensões settleable de um set (espelha buildSettleablePalpiteRows).
const ALL_FIVE_LINES: SeedLine[] = [
  { type: "exact_score", params: { home: 2, away: 0 }, settleable: true },
  { type: "margin", params: { side: "home", minMargin: 2 }, settleable: true },
  { type: "clean_sheet", params: { side: "home" }, settleable: true },
  { type: "first_half_score", params: { home: 1, away: 0 }, settleable: true },
  { type: "first_to_score", params: { firstToScore: "home" }, settleable: true },
];

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "pending-latest@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [u2] = await realDb
    .insert(schema.users)
    .values({ email: "pending-other@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.otherUserId = u2.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
  await realDb.delete(schema.matches);
});

describe("getPendingPalpiteSettlements — latest-only", () => {
  it("2 sets no mesmo jogo/usuário → SÓ a linha da última geração é pendente", async () => {
    const matchId = await seedMatch("ext-2sets");
    const older = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      params: { home: 1, away: 0 },
    });
    const newer = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T12:00:00Z"),
      params: { home: 2, away: 1 },
    });

    const pending = await getPendingPalpiteSettlements(NOW);
    const ids_ = pending.map((p) => p.palpiteId);
    expect(ids_).toContain(newer.palpiteId);
    expect(ids_).not.toContain(older.palpiteId);
    expect(pending).toHaveLength(1);
  });

  it("empate de createdAt → SÓ a geração de maior id é pendente (tiebreak determinístico, espelha o desc(id) do display)", async () => {
    const matchId = await seedMatch("ext-tie");
    const sameTs = new Date("2026-05-14T10:00:00Z");
    const a = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: sameTs,
      params: { home: 1, away: 0 },
    });
    const b = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: sameTs,
      params: { home: 2, away: 2 },
    });
    // id é uuid: a comparação lexicográfica do texto canônico (lowercase) casa com a
    // ordenação de uuid do Postgres → o de maior id vence o tiebreak (gt(id)).
    const winner = a.setId > b.setId ? a : b;
    const loser = a.setId > b.setId ? b : a;
    const pending = await getPendingPalpiteSettlements(NOW);
    expect(pending.map((p) => p.palpiteId)).toEqual([winner.palpiteId]);
    expect(pending.map((p) => p.palpiteId)).not.toContain(loser.palpiteId);
  });

  it("1 set → liquida normalmente (não filtra a única geração)", async () => {
    const matchId = await seedMatch("ext-1set");
    const only = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      params: { home: 0, away: 0 },
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    expect(pending.map((p) => p.palpiteId)).toEqual([only.palpiteId]);
  });

  it("o filtro é por (matchId,userId): sets de OUTRO usuário no mesmo jogo não se cancelam", async () => {
    const matchId = await seedMatch("ext-2users");
    const mine = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      params: { home: 1, away: 1 },
    });
    const theirs = await seedSetWithScore({
      matchId,
      userId: ids.otherUserId,
      createdAt: new Date("2026-05-14T11:00:00Z"),
      params: { home: 2, away: 0 },
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    const set = new Set(pending.map((p) => p.palpiteId));
    // Cada usuário tem 1 geração → ambas pendentes (latest-only é POR usuário).
    expect(set.has(mine.palpiteId)).toBe(true);
    expect(set.has(theirs.palpiteId)).toBe(true);
    expect(pending).toHaveLength(2);
  });
});

describe("getPendingPalpiteSettlements — multi-tipo (#354)", () => {
  it("set com as 5 dimensões settleable → todas as 5 rows voltam pendentes, com `type`", async () => {
    const matchId = await seedMatch("ext-5dims");
    const { palpiteIds } = await seedSetWithLines({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      lines: ALL_FIVE_LINES,
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    expect(pending).toHaveLength(5);
    const types = new Set(pending.map((p) => p.type));
    expect(types).toEqual(
      new Set([
        "exact_score",
        "margin",
        "clean_sheet",
        "first_half_score",
        "first_to_score",
      ]),
    );
    // `type` presente no shape e casando o palpiteId.
    for (const p of pending) {
      expect(p.palpiteId).toBe(palpiteIds[p.type]);
    }
  });

  it("LATEST-ONLY com multi-row: 2 sets de 5 dims → SÓ as 5 do último set; nenhuma das 5 antigas vaza", async () => {
    const matchId = await seedMatch("ext-2sets-5dims");
    const older = await seedSetWithLines({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      lines: ALL_FIVE_LINES,
    });
    const newer = await seedSetWithLines({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T12:00:00Z"),
      lines: ALL_FIVE_LINES,
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    expect(pending).toHaveLength(5);
    const pendingIds = new Set(pending.map((p) => p.palpiteId));
    for (const id of Object.values(newer.palpiteIds)) {
      expect(pendingIds.has(id)).toBe(true);
    }
    for (const id of Object.values(older.palpiteIds)) {
      expect(pendingIds.has(id)).toBe(false);
    }
  });

  it("red_card/corners (settleable=false) NUNCA voltam (gate inArray + settleable)", async () => {
    const matchId = await seedMatch("ext-funonly");
    const { palpiteIds } = await seedSetWithLines({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      lines: [
        ...ALL_FIVE_LINES,
        { type: "red_card", params: null, settleable: false },
        { type: "corners", params: null, settleable: false },
      ],
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    const pendingIds = new Set(pending.map((p) => p.palpiteId));
    expect(pending).toHaveLength(5);
    expect(pendingIds.has(palpiteIds.red_card)).toBe(false);
    expect(pendingIds.has(palpiteIds.corners)).toBe(false);
  });
});
