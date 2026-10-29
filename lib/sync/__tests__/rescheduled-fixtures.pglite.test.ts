// @vitest-environment node
//
// Jogo remarcado contra Postgres real (pglite): o reconcile + o upsert do sync deixam
// UMA row por jogo, com o horário novo e o mesmo id (análises, apostas e bolão seguem
// apontando pra ela). Mesmo template de upsert-matches-crest.pglite.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { compositeFixtureKey, type NormalizedFixture } from "@/lib/providers/sports-data/types";

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
  getMatchesInRange,
  SUPERSEDED_KEY_PREFIX,
  upsertMatchesFromProvider,
} from "@/lib/db/queries/matches";
import { reconcileRescheduledFixtures } from "@/lib/sync/rescheduled-fixtures";

const NOW = new Date("2026-10-28T23:30:00.000Z");
const OLD = "2026-10-28T21:00:00.000Z";
const NEW = "2026-10-29T00:30:00.000Z";

function fixture(kickoffAt: string, over: Partial<NormalizedFixture> = {}): NormalizedFixture {
  return {
    id: "x",
    league: "brasileirao_a",
    kickoffAt,
    kickoffTimestampMs: Date.parse(kickoffAt),
    homeTeam: "EC Bahia",
    awayTeam: "São Paulo FC",
    status: "scheduled",
    score: { home: null, away: null },
    ...over,
  };
}

// O que o sync faz por rodada.
async function syncRound(fixtures: NormalizedFixture[]) {
  await reconcileRescheduledFixtures(fixtures, NOW);
  await upsertMatchesFromProvider(fixtures);
}

async function allMatches() {
  return realDb
    .select({
      id: schema.matches.id,
      externalId: schema.matches.externalId,
      kickoffAt: schema.matches.kickoffAt,
      status: schema.matches.status,
    })
    .from(schema.matches)
    .orderBy(schema.matches.kickoffAt);
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
});

beforeEach(async () => {
  await realDb.delete(schema.friendPools);
  await realDb.delete(schema.matchLiveStates);
  await realDb.delete(schema.matches);
  await realDb.delete(schema.users);
});

async function matchIdByKey(key: string): Promise<string> {
  const [m] = await realDb
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(eq(schema.matches.externalId, key));
  return m.id;
}

// Um bolão no jogo: o dado de usuário que decide qual cópia fica.
async function addPool(matchId: string) {
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: `u-${matchId}@test.dev` })
    .returning({ id: schema.users.id });
  await realDb.insert(schema.friendPools).values({ userId: u.id, matchId });
}

afterAll(async () => {
  await client.close();
});

describe("jogo remarcado no sync", () => {
  it("mantém uma row só, com o mesmo id e o horário novo", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await syncRound([fixture(OLD)]);
    const [before] = await allMatches();

    await syncRound([fixture(NEW)]);

    const after = await allMatches();
    expect(after).toEqual([
      {
        id: before.id,
        externalId: compositeFixtureKey(fixture(NEW)),
        kickoffAt: new Date(NEW),
        status: "scheduled",
      },
    ]);
  });

  it("cópia velha duplicada e sem dados é aposentada, some da lista e a nova fica", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Estado de produção antes da correção: as duas rows, a velha ainda `scheduled`.
    await upsertMatchesFromProvider([fixture(OLD), fixture(NEW)]);
    const oldId = await matchIdByKey(compositeFixtureKey(fixture(OLD)));

    await syncRound([fixture(NEW)]);

    const rows = await allMatches();
    expect(rows.map((r) => [r.externalId, r.status])).toEqual([
      [`${SUPERSEDED_KEY_PREFIX}${oldId}:${compositeFixtureKey(fixture(OLD))}`, "postponed"],
      [compositeFixtureKey(fixture(NEW)), "scheduled"],
    ]);
    const listed = await getMatchesInRange({ from: null, to: null });
    expect(listed.map((m) => m.externalId)).toEqual([compositeFixtureKey(fixture(NEW))]);

    // Rodada seguinte: nada muda (idempotente).
    await syncRound([fixture(NEW)]);
    expect(await allMatches()).toEqual(rows);
  });

  it("cópia velha com bolão herda a chave nova; a nova, vazia, é aposentada", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await upsertMatchesFromProvider([fixture(OLD), fixture(NEW)]);
    const oldId = await matchIdByKey(compositeFixtureKey(fixture(OLD)));
    const newId = await matchIdByKey(compositeFixtureKey(fixture(NEW)));
    await addPool(oldId);

    await syncRound([fixture(NEW)]);

    const rows = await allMatches();
    expect(rows.find((r) => r.id === oldId)).toMatchObject({
      externalId: compositeFixtureKey(fixture(NEW)),
      kickoffAt: new Date(NEW),
      status: "scheduled",
    });
    expect(rows.find((r) => r.id === newId)).toMatchObject({
      externalId: `${SUPERSEDED_KEY_PREFIX}${newId}:${compositeFixtureKey(fixture(NEW))}`,
      status: "postponed",
    });
  });

  it("as duas com dados: fica a nova e a velha aposentada gera aviso pra acerto manual", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await upsertMatchesFromProvider([fixture(OLD), fixture(NEW)]);
    const oldId = await matchIdByKey(compositeFixtureKey(fixture(OLD)));
    const newId = await matchIdByKey(compositeFixtureKey(fixture(NEW)));
    await addPool(oldId);
    await addPool(newId);

    await syncRound([fixture(NEW)]);

    const rows = await allMatches();
    expect(rows.find((r) => r.id === newId)?.externalId).toBe(compositeFixtureKey(fixture(NEW)));
    expect(rows.find((r) => r.id === oldId)?.status).toBe("postponed");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("superseded_with_user_data"));
    warn.mockRestore();
  });

  it("o estado ao vivo do horário velho sai com o rekey (um PST travaria o novo)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await syncRound([fixture(OLD)]);
    const id = await matchIdByKey(compositeFixtureKey(fixture(OLD)));
    await realDb.insert(schema.matchLiveStates).values({
      matchId: id,
      statusShort: "PST",
      fetchedAt: new Date(OLD),
    });

    await syncRound([fixture(NEW)]);

    expect(await realDb.select().from(schema.matchLiveStates)).toEqual([]);
  });

  it("jogo encerrado com a chave sumida do provider não é tocado", async () => {
    await upsertMatchesFromProvider([fixture(OLD, { status: "finished", score: { home: 1, away: 0 } })]);
    await syncRound([fixture(NEW)]);
    const rows = await allMatches();
    const old = rows.find((r) => r.externalId === compositeFixtureKey(fixture(OLD)));
    expect(old?.status).toBe("finished");
    const [{ kickoffAt }] = await realDb
      .select({ kickoffAt: schema.matches.kickoffAt })
      .from(schema.matches)
      .where(eq(schema.matches.externalId, compositeFixtureKey(fixture(OLD))));
    expect(kickoffAt).toEqual(new Date(OLD));
  });
});
