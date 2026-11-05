// @vitest-environment node
//
// getLatestPalpiteHeadlinesForMatches (/jogos, #662) contra Postgres real (pglite): o set
// mais recente de cada jogo do usuário (DISTINCT ON + createdAt/id desc), só os campos
// da manchete que a linha usa, o placar da linha exact_score e o set mais recente sem
// manchete tirando o jogo do Map (como a página do jogo, que lê o set mais recente).
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
    }
  ),
}));

import { getLatestPalpiteHeadlinesForMatches } from "@/lib/db/queries/palpites";

const ids = {} as { userId: string; otherUserId: string; m1: string; m2: string; m3: string };

function headline(verdict: string): schema.PalpiteHeadline {
  return {
    verdict,
    confidence: "media",
    narrative: `Resumo de ${verdict}.`,
    citedMarkets: [],
    sourcePredictionIds: [],
    reasoning: [],
  } as schema.PalpiteHeadline;
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });
  const [u] = await base
    .insert(schema.users)
    .values({ email: "lista@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  const [o] = await base
    .insert(schema.users)
    .values({ email: "outro@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  ids.otherUserId = o.id;
  const ms = await base
    .insert(schema.matches)
    .values(
      [1, 2, 3].map((n) => ({
        externalId: `ext-lista-${n}`,
        league: "brasileirao_a" as const,
        homeTeam: `Casa ${n}`,
        awayTeam: `Fora ${n}`,
        kickoffAt: new Date(`2026-05-1${n}T19:00:00Z`),
      }))
    )
    .returning({ id: schema.matches.id });
  [ids.m1, ids.m2, ids.m3] = ms.map((m) => m.id);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
});

async function insertSet(v: {
  matchId: string;
  userId?: string;
  headline: schema.PalpiteHeadline | null;
  createdAt: Date;
  score?: { home: number; away: number };
}) {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: v.matchId,
      userId: v.userId ?? ids.userId,
      modelVersion: "m",
      promptVersion: "p",
      headline: v.headline,
      createdAt: v.createdAt,
    })
    .returning({ id: schema.palpiteSets.id });
  if (v.score) {
    await realDb.insert(schema.palpites).values({
      palpiteSetId: s.id,
      type: "exact_score",
      text: `${v.score.home} x ${v.score.away}`,
      params: v.score,
      settleable: true,
    });
  }
}

describe("getLatestPalpiteHeadlinesForMatches", () => {
  it("lista vazia não consulta nada", async () => {
    expect((await getLatestPalpiteHeadlinesForMatches({ matchIds: [], userId: ids.userId })).size).toBe(0);
  });

  it("o set mais recente de cada jogo, do usuário, com o placar provável", async () => {
    await insertSet({ matchId: ids.m1, headline: headline("antigo"), createdAt: new Date("2026-05-01"), score: { home: 0, away: 0 } });
    await insertSet({ matchId: ids.m1, headline: headline("novo"), createdAt: new Date("2026-05-02"), score: { home: 2, away: 1 } });
    await insertSet({ matchId: ids.m2, headline: headline("sem placar"), createdAt: new Date("2026-05-02") });
    await insertSet({ matchId: ids.m1, userId: ids.otherUserId, headline: headline("de outro"), createdAt: new Date("2026-05-03") });

    const map = await getLatestPalpiteHeadlinesForMatches({
      matchIds: [ids.m1, ids.m2, ids.m3],
      userId: ids.userId,
    });
    expect(map.get(ids.m1)).toEqual({
      verdict: "novo",
      narrative: "Resumo de novo.",
      confidence: "media",
      probableScore: { home: 2, away: 1 },
    });
    expect(map.get(ids.m2)).toMatchObject({ verdict: "sem placar", probableScore: null });
    expect(map.has(ids.m3)).toBe(false);
  });

  it("set mais recente sem manchete tira o jogo do Map (não mostra um veredito velho)", async () => {
    await insertSet({ matchId: ids.m1, headline: headline("velho"), createdAt: new Date("2026-05-01") });
    await insertSet({ matchId: ids.m1, headline: null, createdAt: new Date("2026-05-02") });
    const map = await getLatestPalpiteHeadlinesForMatches({ matchIds: [ids.m1], userId: ids.userId });
    expect(map.has(ids.m1)).toBe(false);
  });
});
