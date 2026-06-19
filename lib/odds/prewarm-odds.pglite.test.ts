// @vitest-environment node
//
// AC do #371 contra Postgres REAL (pglite): "snapshot fresca → sem chamada ao
// provider no load". `prewarmOdds` itera ACTIVE_LEAGUES (world_cup hoje), acha jogo
// próximo via getMatchesInLeagueWindow e chama `ensureOddsSnapshotsFresh` com
// PAGE_LIVE_MARKETS (over/under + 1X2, ambos featured). Fetch MOCKADO no seam
// `@/lib/providers/odds-api` (getOddsForSport) — zero rede, zero quota real. Roda em
// `node` (pglite falha sob jsdom). Espelha o harness de fetch-and-snapshot.pglite.test.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
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

// getOddsForSport (featured/batch) é o único fetch que o caminho featured usa.
// getEventsForSport/getOddsForEvent não são tocados por PAGE_LIVE_MARKETS (ambos
// featured), mas mockamos os 3 pra blindar o seam (espelha fetch-and-snapshot.pglite).
const getOddsForSport = vi.fn<() => Promise<OddsApiEventOdds[]>>();
const getEventsForSport = vi.fn();
const getOddsForEvent = vi.fn<() => Promise<OddsApiEventOdds>>();
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: (...args: unknown[]) => getOddsForSport(...(args as [])),
  getEventsForSport: (...args: unknown[]) => getEventsForSport(...(args as [])),
  getOddsForEvent: (...args: unknown[]) => getOddsForEvent(...(args as [])),
  // prewarmOdds importa getLastOddsApiQuota (linha de summary). Sem fetch real, null.
  getLastOddsApiQuota: () => null,
}));

import { prewarmOdds } from "@/lib/odds/prewarm-odds";
import { getLatestSelectionOddsSnapshots } from "@/lib/db/queries/odds-snapshots";

const HOME = "Brazil";
const AWAY = "Argentina";
const HOME_2 = "France";
const AWAY_2 = "Spain";

// soccer_fifa_world_cup = sport key da liga world_cup (odds-api-constants).
const SPORT_KEY = "soccer_fifa_world_cup";

// Dois jogos da MESMA liga (world_cup) dentro da janela de 48h, pra provar que UMA
// chamada featured (batch) aquece a liga inteira (one-fetch-per-league).
const KICKOFF_1 = new Date(Date.now() + 6 * 60 * 60 * 1000); // +6h
const KICKOFF_2 = new Date(Date.now() + 30 * 60 * 60 * 1000); // +30h
const matchIds: { id1: string; id2: string } = {} as never;

vi.mock("@/lib/config/active-leagues", () => ({
  ACTIVE_LEAGUES: ["world_cup"] as const,
}));

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  // shim de batch: pglite (PgDatabase) não tem .batch nativo (só neon-http). Awaita os
  // builders em sequência (atomicidade real = job do neon-http). Copiado verbatim de
  // fetch-and-snapshot.pglite.test.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (realDb as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };

  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [m1] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-prewarm-1",
      league: "world_cup",
      homeTeam: HOME,
      awayTeam: AWAY,
      kickoffAt: KICKOFF_1,
    })
    .returning({ id: schema.matches.id });
  matchIds.id1 = m1.id;

  const [m2] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-prewarm-2",
      league: "world_cup",
      homeTeam: HOME_2,
      awayTeam: AWAY_2,
      kickoffAt: KICKOFF_2,
    })
    .returning({ id: schema.matches.id });
  matchIds.id2 = m2.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  getOddsForSport.mockReset();
  getEventsForSport.mockReset();
  getOddsForEvent.mockReset();
  await realDb.delete(schema.selectionOddsSnapshots);
});

// Evento h2h (1X2) pra um par de times no sport key da Copa.
function h2hEvent(
  home: string,
  away: string,
  kickoff: Date,
  id: string,
): OddsApiEventOdds {
  return {
    id,
    sport_key: SPORT_KEY,
    commence_time: kickoff.toISOString(),
    home_team: home,
    away_team: away,
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2026-06-15T12:00:00Z",
        markets: [
          {
            key: "h2h",
            last_update: "2026-06-15T12:00:00Z",
            outcomes: [
              { name: home, price: 2.1 },
              { name: "Draw", price: 3.4 },
              { name: away, price: 3.9 },
            ],
          },
        ],
      },
    ],
  };
}

// Evento totals (over/under) pra um par de times no sport key da Copa.
function totalsEvent(
  home: string,
  away: string,
  kickoff: Date,
  id: string,
): OddsApiEventOdds {
  return {
    id,
    sport_key: SPORT_KEY,
    commence_time: kickoff.toISOString(),
    home_team: home,
    away_team: away,
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2026-06-15T12:00:00Z",
        markets: [
          {
            key: "totals",
            last_update: "2026-06-15T12:00:00Z",
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

// getOddsForSport é chamado por mercado featured (over_under→totals, match_result→h2h).
// PAGE_LIVE_MARKETS resolve cada chamada pelo provider markets pedido (totals ou h2h).
// Retornamos os DOIS jogos da liga em cada batch (o adapter normaliza; pickBestBookmaker
// casa por times) — assim a janela inteira é coberta numa só call por mercado.
function batchFor(markets: string[]): OddsApiEventOdds[] {
  const wantsTotals = markets.includes("totals");
  return [
    wantsTotals
      ? totalsEvent(HOME, AWAY, KICKOFF_1, "wc-1")
      : h2hEvent(HOME, AWAY, KICKOFF_1, "wc-1"),
    wantsTotals
      ? totalsEvent(HOME_2, AWAY_2, KICKOFF_2, "wc-2")
      : h2hEvent(HOME_2, AWAY_2, KICKOFF_2, "wc-2"),
  ];
}

describe("prewarmOdds — pré-aquecimento de odds das ligas ativas (pglite)", () => {
  it("STALE: aquece a liga (fetch por mercado featured) e grava snapshots dos jogos próximos", async () => {
    getOddsForSport.mockImplementation((...args: unknown[]) => {
      const opts = args[1] as { markets: string[] };
      return Promise.resolve(batchFor(opts.markets));
    });
    const now = new Date();

    const summary = await prewarmOdds({ now });

    // PAGE_LIVE_MARKETS = [over_under, match_result] → 2 mercados featured → 2 batches.
    expect(getOddsForSport).toHaveBeenCalledTimes(2);
    expect(getEventsForSport).not.toHaveBeenCalled();
    expect(getOddsForEvent).not.toHaveBeenCalled();
    expect(summary.errors).toBe(0);
    expect(summary.warmedLeagues).toBe(1);
    expect(summary.consideredLeagues).toBe(1);
    expect(summary.consideredMatches).toBe(2);

    // over/under (linha 2.5) gravado pros DOIS jogos via o batch único.
    for (const id of [matchIds.id1, matchIds.id2]) {
      const ou = await getLatestSelectionOddsSnapshots({
        matchId: id,
        dbMarketKey: "over_under",
        params: { line: 2.5 },
      });
      expect(ou, `over_under match ${id}`).not.toBeNull();
      expect(ou!.selections).toHaveLength(2);

      const mr = await getLatestSelectionOddsSnapshots({
        matchId: id,
        dbMarketKey: "match_result",
      });
      expect(mr, `match_result match ${id}`).not.toBeNull();
      expect(mr!.selections).toHaveLength(3);
    }
  });

  it("AC: snapshot fresca → NENHUMA chamada ao provider no run seguinte (dentro do gate de 30min)", async () => {
    getOddsForSport.mockImplementation((...args: unknown[]) => {
      const opts = args[1] as { markets: string[] };
      return Promise.resolve(batchFor(opts.markets));
    });
    const now = new Date();

    // 1º run: semeia snapshots frescas pra PAGE_LIVE_MARKETS.
    await prewarmOdds({ now });
    expect(getOddsForSport).toHaveBeenCalledTimes(2);

    // 2º run 60s depois (< 30min de frescor): o gate curto-circuita, ZERO fetch.
    getOddsForSport.mockClear();
    const summary = await prewarmOdds({ now: new Date(now.getTime() + 60_000) });

    expect(getOddsForSport).not.toHaveBeenCalled();
    expect(getEventsForSport).not.toHaveBeenCalled();
    expect(getOddsForEvent).not.toHaveBeenCalled();
    expect(summary.errors).toBe(0);
    expect(summary.warmedLeagues).toBe(1);
  });

  it("ONE-FETCH-PER-LEAGUE: liga com N jogos próximos dispara UM batch por mercado (não por jogo)", async () => {
    getOddsForSport.mockImplementation((...args: unknown[]) => {
      const opts = args[1] as { markets: string[] };
      return Promise.resolve(batchFor(opts.markets));
    });
    const now = new Date();

    const summary = await prewarmOdds({ now });

    // 2 jogos na janela, mas só 2 batches (1 por mercado featured), NÃO 4 (1 por jogo).
    expect(getOddsForSport).toHaveBeenCalledTimes(2);
    expect(summary.consideredMatches).toBe(2);
    expect(summary.warmedLeagues).toBe(1);
  });
});
