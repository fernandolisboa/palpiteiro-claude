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

// getOddsForSport (featured/batch), getEventsForSport + getOddsForEvent (additional/
// por evento) são mockados por teste (sem rede). leagueToSportKey/etc são reais.
const getOddsForSport = vi.fn<() => Promise<OddsApiEventOdds[]>>();
const getEventsForSport = vi.fn();
const getOddsForEvent = vi.fn<() => Promise<OddsApiEventOdds>>();
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: (...args: unknown[]) => getOddsForSport(...(args as [])),
  getEventsForSport: (...args: unknown[]) => getEventsForSport(...(args as [])),
  getOddsForEvent: (...args: unknown[]) => getOddsForEvent(...(args as [])),
}));

import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import {
  BTTS,
  MATCH_RESULT,
  OVER_UNDER,
  OVER_UNDER_ALT,
} from "@/lib/odds/market-descriptor";
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

  // match_result (+ home/draw/away) agora é seedado pela migration 0014 (#173),
  // junto com over_under (0009) — não precisa hand-seed aqui (insert duplicado
  // violaria markets_key_unique). Os testes resolvem o mercado via dbMarketKey.
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  getOddsForSport.mockReset();
  getEventsForSport.mockReset();
  getOddsForEvent.mockReset();
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

// btts (additional): payload por evento COM odds + item da lista GRATUITA (sem odds).
function bttsEvent(): OddsApiEventOdds {
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
            key: "btts",
            last_update: "2026-05-15T12:00:00Z",
            outcomes: [
              { name: "Yes", price: 2.06 },
              { name: "No", price: 1.81 },
            ],
          },
        ],
      },
    ],
  };
}

function bttsEventListItem() {
  return {
    id: "evt-1",
    sport_key: "soccer_brazil_campeonato",
    commence_time: KICKOFF.toISOString(),
    home_team: "CR Flamengo",
    away_team: "Fluminense FC",
  };
}

// alternate_totals (additional): a ESCADA por evento (#175) — 1.5/2.5/3.5 num só
// market, cada linha com seu par Over/Under (como o payload real validado).
function altTotalsEvent(): OddsApiEventOdds {
  const rungs = [
    { point: 1.5, over: 1.3, under: 3.5 },
    { point: 2.5, over: 1.9, under: 1.95 },
    { point: 3.5, over: 3.4, under: 1.32 },
  ];
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
            key: "alternate_totals",
            last_update: "2026-05-15T12:00:00Z",
            outcomes: rungs.flatMap((r) => [
              { name: "Over", price: r.over, point: r.point },
              { name: "Under", price: r.under, point: r.point },
            ]),
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

describe("ensureOddsSnapshotsFresh — btts additional per-event fetch (NUNCA batch)", () => {
  it("busca por evento, grava só a tabela nova (yes/no), NUNCA chama getOddsForSport", async () => {
    getEventsForSport.mockResolvedValue([bttsEventListItem()]); // lista gratuita
    getOddsForEvent.mockResolvedValue(bttsEvent());
    const now = new Date();
    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];

    await ensureOddsSnapshotsFresh(match, { now, markets: [BTTS] });

    // INVARIANTE DE QUOTA: additional NUNCA batcheia a liga.
    expect(getOddsForSport).not.toHaveBeenCalled();
    // 1 fetch por evento, com markets=['btts'] explícito (sem resolveCsv→totals).
    expect(getOddsForEvent).toHaveBeenCalledTimes(1);
    expect(getOddsForEvent).toHaveBeenCalledWith(
      expect.any(String),
      "evt-1",
      expect.objectContaining({ markets: ["btts"], regions: ["eu"] }),
    );

    // tabela legada over/under intacta (guard de dual-write exclui btts).
    const old = await realDb
      .select()
      .from(schema.matchOddsSnapshots)
      .where(eq(schema.matchOddsSnapshots.matchId, matchIds.id));
    expect(old).toHaveLength(0);

    // tabela nova: 2 rows yes/no, mesmo book/captured_at.
    const latest = await getLatestSelectionOddsSnapshots({
      matchId: matchIds.id,
      dbMarketKey: "btts",
    });
    expect(latest).not.toBeNull();
    expect(latest!.selections).toHaveLength(2);
    expect(latest!.bookmaker).toBe("Pinnacle");
    const byKey = new Map(latest!.selections.map((s) => [s.key, s.odd]));
    expect(byKey.get("yes")).toBe("2.060");
    expect(byKey.get("no")).toBe("1.810");
    expect(latest!.capturedAt.getTime()).toBe(now.getTime());
  });

  it("dedup pelo gate de frescor: 2ª análise dentro do TTL não re-gasta quota", async () => {
    getEventsForSport.mockResolvedValue([bttsEventListItem()]);
    getOddsForEvent.mockResolvedValue(bttsEvent());
    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];

    const now = new Date();
    await ensureOddsSnapshotsFresh(match, { now, markets: [BTTS] });
    // 2ª chamada 1min depois (< 30min de frescor) → snapshot fresco, sem novo fetch.
    await ensureOddsSnapshotsFresh(match, {
      now: new Date(now.getTime() + 60_000),
      markets: [BTTS],
    });

    expect(getOddsForEvent).toHaveBeenCalledTimes(1); // 1 crédito, não 2
  });

  it("sem evento pareado na lista → degrada sem fetch de odds e sem escrita", async () => {
    getEventsForSport.mockResolvedValue([]); // nenhum evento
    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];

    await ensureOddsSnapshotsFresh(match, { now: new Date(), markets: [BTTS] });

    expect(getOddsForEvent).not.toHaveBeenCalled();
    const latest = await getLatestSelectionOddsSnapshots({
      matchId: matchIds.id,
      dbMarketKey: "btts",
    });
    expect(latest).toBeNull();
  });
});

describe("ensureOddsSnapshotsFresh — over_under_alt additional multi-linha (#175)", () => {
  it("UM fetch (alternate_totals) grava 3 linhas × 2 seleções na tabela nova; legado intacto", async () => {
    getEventsForSport.mockResolvedValue([bttsEventListItem()]); // mesma lista gratuita
    getOddsForEvent.mockResolvedValue(altTotalsEvent());
    const now = new Date();
    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];

    await ensureOddsSnapshotsFresh(match, { now, markets: [OVER_UNDER_ALT] });

    // INVARIANTE DE QUOTA: 1 crédito (1 getOddsForEvent), NUNCA batch — a escada
    // inteira (1.5/2.5/3.5) vem num só fetch com markets=['alternate_totals'].
    expect(getOddsForSport).not.toHaveBeenCalled();
    expect(getOddsForEvent).toHaveBeenCalledTimes(1);
    expect(getOddsForEvent).toHaveBeenCalledWith(
      expect.any(String),
      "evt-1",
      expect.objectContaining({ markets: ["alternate_totals"], regions: ["eu"] }),
    );

    // tabela LEGADA over/under (match_odds_snapshots) intacta — alt é additional,
    // NÃO faz dual-write no legado (só linha 2.5 featured escreveria lá).
    const old = await realDb
      .select()
      .from(schema.matchOddsSnapshots)
      .where(eq(schema.matchOddsSnapshots.matchId, matchIds.id));
    expect(old).toHaveLength(0);

    // tabela nova: por linha, 2 seleções (over/under) com as odds da rung + marketParams.line.
    const expected = new Map<number, { over: string; under: string }>([
      [1.5, { over: "1.300", under: "3.500" }],
      [2.5, { over: "1.900", under: "1.950" }],
      [3.5, { over: "3.400", under: "1.320" }],
    ]);
    for (const [line, exp] of expected) {
      const latest = await getLatestSelectionOddsSnapshots({
        matchId: matchIds.id,
        dbMarketKey: "over_under",
        params: { line },
      });
      expect(latest, `linha ${line}`).not.toBeNull();
      expect(latest!.selections).toHaveLength(2);
      expect(latest!.bookmaker).toBe("Pinnacle");
      const byKey = new Map(latest!.selections.map((s) => [s.key, s.odd]));
      expect(byKey.get("over")).toBe(exp.over);
      expect(byKey.get("under")).toBe(exp.under);
      expect(latest!.capturedAt.getTime()).toBe(now.getTime());
    }
  });

  it("dedup por linha: 2ª análise dentro do TTL não re-gasta quota", async () => {
    getEventsForSport.mockResolvedValue([bttsEventListItem()]);
    getOddsForEvent.mockResolvedValue(altTotalsEvent());
    const now = new Date();
    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];

    await ensureOddsSnapshotsFresh(match, { now, markets: [OVER_UNDER_ALT] });
    await ensureOddsSnapshotsFresh(match, {
      now: new Date(now.getTime() + 60_000),
      markets: [OVER_UNDER_ALT],
    });

    expect(getOddsForEvent).toHaveBeenCalledTimes(1); // 1 crédito, não 2
  });
});
