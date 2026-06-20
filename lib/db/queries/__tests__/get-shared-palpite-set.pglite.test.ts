// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM) pra getSharedPalpiteSet /
// getPalpiteSetOwner / setPalpiteSetSharedAt (#384, ADR 0035): a query pública por-setId
// com o GATE opt-in shared_at IS NOT NULL, NÃO escopada por userId (link resolvível por
// qualquer um). Roda em `node` (pglite falha sob jsdom).
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

import {
  getSharedPalpiteSet,
  getPalpiteSetOwner,
  setPalpiteSetSharedAt,
} from "@/lib/db/queries/palpites";

const ids: {
  userId: string;
  otherUserId: string;
  matchId: string;
} = {} as never;

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "shared-owner@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  const [other] = await base
    .insert(schema.users)
    .values({ email: "shared-other@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.otherUserId = other.id;

  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-shared-1",
      league: "brasileirao_a",
      homeTeam: "SE Palmeiras",
      awayTeam: "SC Corinthians",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
});

async function insertSet(values: {
  userId?: string;
  sharedAt?: Date | null;
}): Promise<string> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: ids.matchId,
      userId: values.userId ?? ids.userId,
      aiCallId: null,
      modelVersion: "claude-haiku",
      promptVersion: "palpites_v7",
      headline: {
        verdict: "Vai dar Palmeiras",
        confidence: "media",
        narrative: "n",
        citedMarkets: ["Resultado (1X2)"],
        sourcePredictionIds: [],
      },
      sharedAt: values.sharedAt === undefined ? new Date() : values.sharedAt,
    })
    .returning({ id: schema.palpiteSets.id });
  return s.id;
}

async function insertExactScore(setId: string): Promise<void> {
  await realDb.insert(schema.palpites).values({
    palpiteSetId: setId,
    type: "exact_score",
    text: "Palmeiras 2 x 1",
    params: { home: 2, away: 1 },
    settleable: true,
  });
}

describe("getSharedPalpiteSet — gate opt-in shared_at", () => {
  it("set com shared_at SET → retornado com linhas + match", async () => {
    const setId = await insertSet({ sharedAt: new Date() });
    await insertExactScore(setId);

    const out = await getSharedPalpiteSet(setId);
    expect(out).not.toBeNull();
    expect(out!.palpiteSetWithLines.palpiteSet.id).toBe(setId);
    expect(out!.palpiteSetWithLines.palpites).toHaveLength(1);
    expect(out!.palpiteSetWithLines.palpites[0].params).toEqual({
      home: 2,
      away: 1,
    });
    expect(out!.match.homeTeam).toBe("SE Palmeiras");
  });

  it("set com shared_at NULL → null (gate opt-in: privado nunca resolve)", async () => {
    const setId = await insertSet({ sharedAt: null });
    await insertExactScore(setId);
    const out = await getSharedPalpiteSet(setId);
    expect(out).toBeNull();
  });

  it("id inexistente → null", async () => {
    const out = await getSharedPalpiteSet(
      "99999999-9999-9999-9999-999999999999",
    );
    expect(out).toBeNull();
  });

  it("NÃO escopa por userId: o set compartilhado de OUTRO usuário resolve", async () => {
    const setId = await insertSet({
      userId: ids.otherUserId,
      sharedAt: new Date(),
    });
    await insertExactScore(setId);
    // Resolve sem passar nenhum userId — a privacidade é o opt-in shared_at, não a sessão.
    const out = await getSharedPalpiteSet(setId);
    expect(out).not.toBeNull();
    expect(out!.palpiteSetWithLines.palpiteSet.userId).toBe(ids.otherUserId);
  });
});

describe("getPalpiteSetOwner — dono + sharedAt (sem gate)", () => {
  it("retorna {userId, sharedAt} mesmo com shared_at NULL (a action checa antes de compartilhar)", async () => {
    const setId = await insertSet({ sharedAt: null });
    const owner = await getPalpiteSetOwner(setId);
    expect(owner).toEqual({ userId: ids.userId, sharedAt: null });
  });

  it("id inexistente → null", async () => {
    const owner = await getPalpiteSetOwner(
      "99999999-9999-9999-9999-999999999999",
    );
    expect(owner).toBeNull();
  });
});

describe("setPalpiteSetSharedAt — carimba NULL→timestamp", () => {
  it("vira um set privado em compartilhado (resolvível depois)", async () => {
    const setId = await insertSet({ sharedAt: null });
    await insertExactScore(setId);
    expect(await getSharedPalpiteSet(setId)).toBeNull();

    const at = new Date("2026-06-10T12:00:00Z");
    await setPalpiteSetSharedAt(setId, at);

    const owner = await getPalpiteSetOwner(setId);
    expect(owner!.sharedAt).not.toBeNull();
    expect(await getSharedPalpiteSet(setId)).not.toBeNull();
  });
});
