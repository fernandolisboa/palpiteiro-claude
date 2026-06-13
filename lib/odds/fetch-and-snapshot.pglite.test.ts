// @vitest-environment node
//
// End-to-end de `ensureOddsSnapshotsFresh` contra Postgres REAL (pglite): fetch
// MOCKADO (getOddsForSport) → pickBestBookmaker → dual-write via db.batch → read
// coerente. Cobre (a) coerência dual-write over/under (old.captured_at ===
// new.captured_at, mesmas odds/book) e (b) 1X2 (h2h, 3 outcomes) write→read
// ponta-a-ponta. Roda em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

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

// getOddsForSport é mockado por teste (sem rede). leagueToSportKey/etc são reais.
const getOddsForSport = vi.fn<() => Promise<OddsApiEventOdds[]>>();
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: (...args: unknown[]) => getOddsForSport(...(args as [])),
}));

import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { MATCH_RESULT, OVER_UNDER } from "@/lib/odds/market-descriptor";
import { getLatestSelectionOddsSnapshots } from "@/lib/db/queries/odds-snapshots";

const KICKOFF = new Date(Date.now() + 24 * 60 * 60 * 1000); // dentro da janela de 7d
const matchIds: { id: string } = {} as never;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  // shim de batch: pglite (PgDatabase) não tem .batch nativo (só neon-http). pglite
  // é single-connection — aninhar uma query do client base dentro de
  // `client.transaction` trava (a query roda fora da tx e bloqueia no lock). Como o
  // que o e2e prova é "ambos os builders são executados e compartilham o mesmo now",
  // o shim só awaita os builders em sequência (atomicidade real = job do neon-http).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (realDb as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };

  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-e2e-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: KICKOFF,
    })
    .returning({ id: schema.matches.id });
  matchIds.id = m.id;

  // match_result seedado SÓ no schema de teste (não é migration de prod).
  const [mr] = await realDb
    .insert(schema.markets)
    .values({
      key: "match_result",
      label: "Resultado (1X2)",
      settlementRuleKey: "match_result",
      isActive: false,
      isGraduated: false,
    })
    .returning({ id: schema.markets.id });
  await realDb.insert(schema.marketSelections).values([
    { marketId: mr.id, key: "home", label: "Casa", sortOrder: 0 },
    { marketId: mr.id, key: "draw", label: "Empate", sortOrder: 1 },
    { marketId: mr.id, key: "away", label: "Fora", sortOrder: 2 },
  ]);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  getOddsForSport.mockReset();
  await realDb.delete(schema.selectionOddsSnapshots);
  await realDb.delete(schema.matchOddsSnapshots);
});

function totalsEvent(): OddsApiEventOdds {
  return {
    id: "evt-1",
    sport_key: "soccer_brazil_campeonato",
    commence_time: KICKOFF.toISOString(),
    home_team: "CR Flamengo",
    away_team: "Fluminense FC",
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2026-05-15T12:00:00Z",
        markets: [
          {
            key: "totals",
            last_update: "2026-05-15T12:00:00Z",
            outcomes: [
              { name: "Over", price: 1.9, point: 2.5 },
              { name: "Under", price: 1.95, point: 2.5 },
            ],
          },
        ],
      },
    ],
  };
}

function h2hEvent(): OddsApiEventOdds {
  return {
    id: "evt-1",
    sport_key: "soccer_brazil_campeonato",
    commence_time: KICKOFF.toISOString(),
    home_team: "CR Flamengo",
    away_team: "Fluminense FC",
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2026-05-15T12:00:00Z",
        markets: [
          {
            key: "h2h",
            last_update: "2026-05-15T12:00:00Z",
            outcomes: [
              { name: "CR Flamengo", price: 2.1 },
              { name: "Draw", price: 3.4 },
              { name: "Fluminense FC", price: 3.9 },
            ],
          },
        ],
      },
    ],
  };
}

describe("ensureOddsSnapshotsFresh — dual-write against real Postgres (pglite)", () => {
  it("over_under: writes both tables with old.captured_at === new.captured_at, same book/odds", async () => {
    getOddsForSport.mockResolvedValue([totalsEvent()]);
    const now = new Date();

    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];
    const result = await ensureOddsSnapshotsFresh(match, { now });

    // retorno = snapshot over/under da tabela VELHA
    expect(result).not.toBeNull();
    expect(result!.bookmaker).toBe("Pinnacle");
    expect(result!.overOdd).toBe("1.900");
    expect(result!.underOdd).toBe("1.950");

    // tabela velha: 1 row over/under
    const old = await realDb
      .select()
      .from(schema.matchOddsSnapshots)
      .where(eq(schema.matchOddsSnapshots.matchId, matchIds.id));
    expect(old).toHaveLength(1);

    // tabela nova: 2 rows (over + under), MESMO captured_at/bookmaker
    const latest = await getLatestSelectionOddsSnapshots({
      matchId: matchIds.id,
      dbMarketKey: "over_under",
      params: { line: 2.5 },
    });
    expect(latest).not.toBeNull();
    expect(latest!.selections).toHaveLength(2);
    expect(latest!.bookmaker).toBe("Pinnacle");
    const byKey = new Map(latest!.selections.map((s) => [s.key, s.odd]));
    expect(byKey.get("over")).toBe("1.900");
    expect(byKey.get("under")).toBe("1.950");

    // COERÊNCIA dual-write: captured_at IDÊNTICO nas duas tabelas
    expect(latest!.capturedAt.getTime()).toBe(old[0].capturedAt.getTime());
    expect(latest!.overroundPct).toBe(old[0].overroundPct);
  });

  it("match_result: 1X2 write→read end-to-end, 3 coherent rows, new table only", async () => {
    getOddsForSport.mockResolvedValue([h2hEvent()]);
    const now = new Date();

    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];
    await ensureOddsSnapshotsFresh(match, { now, markets: [MATCH_RESULT] });

    // só a tabela NOVA é populada (a velha é só over/under)
    const old = await realDb
      .select()
      .from(schema.matchOddsSnapshots)
      .where(eq(schema.matchOddsSnapshots.matchId, matchIds.id));
    expect(old).toHaveLength(0);

    const latest = await getLatestSelectionOddsSnapshots({
      matchId: matchIds.id,
      dbMarketKey: "match_result",
    });
    expect(latest).not.toBeNull();
    expect(latest!.selections).toHaveLength(3);
    expect(latest!.bookmaker).toBe("Pinnacle");
    const byKey = new Map(latest!.selections.map((s) => [s.key, s.odd]));
    expect(byKey.get("home")).toBe("2.100");
    expect(byKey.get("draw")).toBe("3.400");
    expect(byKey.get("away")).toBe("3.900");
    // captura coerente: todas as 3 rows no mesmo captured_at
    expect(latest!.capturedAt.getTime()).toBe(now.getTime());
  });

  // NB: prova que as DUAS tabelas são escritas num único db.batch; NÃO prova
  // rollback-on-partial-failure (o shim .batch awaita em sequência, sem txn — o
  // round-trip transacional real é responsabilidade do neon-http em prod).
  it("dual-write: uma busca over/under grava over_under nas DUAS tabelas (um db.batch)", async () => {
    getOddsForSport.mockResolvedValue([totalsEvent()]);
    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];
    await ensureOddsSnapshotsFresh(match, { now: new Date(), markets: [OVER_UNDER] });

    const oldCount = (
      await realDb.select().from(schema.matchOddsSnapshots)
    ).length;
    const newCount = (
      await realDb
        .select()
        .from(schema.selectionOddsSnapshots)
        .where(
          and(
            eq(schema.selectionOddsSnapshots.matchId, matchIds.id),
          ),
        )
    ).length;
    expect(oldCount).toBe(1); // 1 row over/under (par numa row)
    expect(newCount).toBe(2); // 2 rows (over + under)
  });
});
