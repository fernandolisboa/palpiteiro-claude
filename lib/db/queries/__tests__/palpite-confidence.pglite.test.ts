// @vitest-environment node
//
// getPalpiteConfidenceRows (#649, ADR 0069) contra Postgres REAL via pglite: só pré-jogo,
// só o set mais novo de cada (jogo, usuário), só exact_score liquidado com placar.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import type { PalpiteHeadline } from "@/db/schema";

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

import { getPalpiteConfidenceRows } from "@/lib/db/queries/palpite-confidence";

const ids: { userId: string; matchA: string; matchB: string } = {} as never;

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "confidence@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  const insertMatch = async (externalId: string) => {
    const [m] = await base
      .insert(schema.matches)
      .values({
        externalId,
        league: "brasileirao_a",
        homeTeam: "SC Internacional",
        awayTeam: "Botafogo FR",
        kickoffAt: new Date("2026-10-24T19:30:00Z"),
        status: "finished",
        homeScore: 1,
        awayScore: 2,
      })
      .returning({ id: schema.matches.id });
    return m.id;
  };
  ids.matchA = await insertMatch("ext-conf-a");
  ids.matchB = await insertMatch("ext-conf-b");
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
});

const motorHeadline = (
  confidence: PalpiteHeadline["confidence"],
  probPct: number | null,
): PalpiteHeadline => ({
  verdict: "Zebra leve",
  confidence,
  confidenceProbPct: probPct,
  confidenceSource: probPct === null ? "none" : "snapshot",
  narrative: "n",
  citedMarkets: [],
  sourcePredictionIds: [],
});

async function insertSettled(args: {
  matchId: string;
  headline: PalpiteHeadline;
  probable: { home: number; away: number };
  result: { home: number; away: number } | null;
  createdAt: Date;
  isLive?: boolean;
}): Promise<void> {
  const [set] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: args.matchId,
      userId: ids.userId,
      aiCallId: null,
      modelVersion: "claude-haiku-5-5",
      promptVersion: "palpites_v12",
      headline: args.headline,
      createdAt: args.createdAt,
      ...(args.isLive
        ? { isLive: true, liveState: { minute: 60 } }
        : {}),
    })
    .returning({ id: schema.palpiteSets.id });
  const [line] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: set.id,
      type: "exact_score",
      text: "placar",
      params: args.probable,
      settleable: true,
    })
    .returning({ id: schema.palpites.id });
  if (args.result) {
    await realDb.insert(schema.palpiteOutcomes).values({
      palpiteId: line.id,
      result: "lost",
      resultData: {
        homeScore: args.result.home,
        awayScore: args.result.away,
        totalGoals: args.result.home + args.result.away,
      },
    });
  }
}

describe("getPalpiteConfidenceRows", () => {
  it("lê era, faixa, P e acerto do RESULTADO (não do placar exato)", async () => {
    await insertSettled({
      matchId: ids.matchA,
      headline: motorHeadline("baixa", 30),
      probable: { home: 0, away: 1 },
      result: { home: 1, away: 2 },
      createdAt: new Date("2026-10-23T20:00:00Z"),
    });
    const rows = (await getPalpiteConfidenceRows()).rows;
    expect(rows).toEqual([
      { matchId: ids.matchA, era: "motor", level: "baixa", probPct: 30, hit: true },
    ]);
  });

  it("só o set de pré-jogo mais novo de cada jogo: o antigo liquidado não volta", async () => {
    await insertSettled({
      matchId: ids.matchA,
      headline: motorHeadline("alta", 60),
      probable: { home: 2, away: 0 },
      result: { home: 1, away: 2 },
      createdAt: new Date("2026-10-23T18:00:00Z"),
    });
    // O mais novo ainda pendente: o jogo fica fora (não cai no antigo).
    await insertSettled({
      matchId: ids.matchA,
      headline: motorHeadline("baixa", 30),
      probable: { home: 1, away: 2 },
      result: null,
      createdAt: new Date("2026-10-23T20:00:00Z"),
    });
    expect((await getPalpiteConfidenceRows()).rows).toEqual([]);
  });

  it("set ao vivo fica fora e não esconde o de pré-jogo", async () => {
    await insertSettled({
      matchId: ids.matchA,
      headline: motorHeadline("media", 45),
      probable: { home: 1, away: 0 },
      result: { home: 1, away: 2 },
      createdAt: new Date("2026-10-23T18:00:00Z"),
    });
    await insertSettled({
      matchId: ids.matchA,
      headline: { ...motorHeadline("alta", 80), confidenceSource: "live_matrix" },
      probable: { home: 1, away: 2 },
      result: { home: 1, away: 2 },
      createdAt: new Date("2026-10-24T20:30:00Z"),
      isLive: true,
    });
    const rows = (await getPalpiteConfidenceRows()).rows;
    expect(rows).toEqual([
      { matchId: ids.matchA, era: "motor", level: "media", probPct: 45, hit: false },
    ]);
  });

  it("liquidado sem placar (override manual) fica fora e é contado", async () => {
    await insertSettled({
      matchId: ids.matchA,
      headline: motorHeadline("media", 45),
      probable: { home: 1, away: 0 },
      result: { home: 1, away: 0 },
      createdAt: new Date("2026-10-23T18:00:00Z"),
    });
    await realDb
      .update(schema.palpiteOutcomes)
      .set({ resultData: null, result: "won" });
    expect(await getPalpiteConfidenceRows()).toEqual({ rows: [], skipped: 1 });
  });

  it("set antigo (palavra do LLM, sem confidenceSource) entra como era llm; sem confiança fica null", async () => {
    await insertSettled({
      matchId: ids.matchA,
      headline: {
        verdict: "x",
        confidence: "alta",
        narrative: "n",
        citedMarkets: [],
        sourcePredictionIds: [],
      },
      probable: { home: 1, away: 1 },
      result: { home: 0, away: 0 },
      createdAt: new Date("2026-10-23T18:00:00Z"),
    });
    await insertSettled({
      matchId: ids.matchB,
      headline: motorHeadline(null, null),
      probable: { home: 2, away: 1 },
      result: { home: 1, away: 2 },
      createdAt: new Date("2026-10-23T18:00:00Z"),
    });
    const rows = (await getPalpiteConfidenceRows()).rows;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { matchId: ids.matchA, era: "llm", level: "alta", probPct: null, hit: true },
        { matchId: ids.matchB, era: "motor", level: null, probPct: null, hit: false },
      ]),
    );
  });
});
