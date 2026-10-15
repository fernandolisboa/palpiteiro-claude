// @vitest-environment node
//
// Escudo dos times (#578) contra Postgres real (pglite): roda a migration 0058 de
// verdade e prova a propriedade do COALESCE no ON CONFLICT DO UPDATE do
// upsertMatchesFromProvider: regravar o jogo SEM escudo não apaga o que existe;
// regravar com escudo novo troca. Mesmo template de friend-pools.pglite.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

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

import { upsertMatchesFromProvider } from "@/lib/db/queries/matches";

const KICKOFF = "2026-11-01T19:00:00.000Z";
const CREST_A = "https://media.api-sports.io/football/teams/121.png";
const CREST_B = "https://media-2.api-sports.io/football/teams/121.png";
const CREST_AWAY = "https://media.api-sports.io/football/teams/127.png";

function fixture(over: Partial<NormalizedFixture> = {}): NormalizedFixture {
  return {
    id: "x",
    league: "brasileirao_a",
    kickoffAt: KICKOFF,
    kickoffTimestampMs: Date.parse(KICKOFF),
    homeTeam: "SE Palmeiras",
    awayTeam: "CR Flamengo",
    status: "scheduled",
    score: { home: null, away: null },
    ...over,
  };
}

async function crests() {
  const rows = await realDb
    .select({
      home: schema.matches.homeTeamCrestUrl,
      away: schema.matches.awayTeamCrestUrl,
      homeTeam: schema.matches.homeTeam,
    })
    .from(schema.matches);
  return rows;
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
});

afterAll(async () => {
  await client.close();
});

describe("upsertMatchesFromProvider — escudo (#578)", () => {
  it("grava, preserva sem escudo e troca com escudo novo", async () => {
    await upsertMatchesFromProvider([
      fixture({ homeCrestUrl: CREST_A, awayCrestUrl: CREST_AWAY }),
    ]);
    expect(await crests()).toEqual([
      { home: CREST_A, away: CREST_AWAY, homeTeam: "SE Palmeiras" },
    ]);

    // Provider da vez sem escudo (fallback, cache antigo): nada é apagado.
    await upsertMatchesFromProvider([fixture()]);
    expect(await crests()).toEqual([
      { home: CREST_A, away: CREST_AWAY, homeTeam: "SE Palmeiras" },
    ]);

    // Escudo novo só no mandante: troca o dele, mantém o do visitante.
    await upsertMatchesFromProvider([fixture({ homeCrestUrl: CREST_B })]);
    expect(await crests()).toEqual([
      { home: CREST_B, away: CREST_AWAY, homeTeam: "SE Palmeiras" },
    ]);
  });

  it("jogo novo sem escudo fica com null", async () => {
    await upsertMatchesFromProvider([fixture({ homeTeam: "SC Corinthians Paulista" })]);
    const row = (await crests()).find((r) => r.homeTeam === "SC Corinthians Paulista");
    expect(row).toEqual({ home: null, away: null, homeTeam: "SC Corinthians Paulista" });
  });
});
