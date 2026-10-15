// @vitest-environment node
//
// End-to-end de `ensureOddsSnapshotsFresh` contra Postgres REAL (pglite): fetch
// MOCKADO (getOddsForSport) → pickBestBookmaker → escrita em selection_odds_snapshots
// → read coerente. Fase 5: a tabela legada match_odds_snapshots saiu, não há mais
// dual-write; over/under escreve a MESMA tabela genérica que os demais mercados.
// Cobre (a) over/under write→read + adapter de retorno binário e (b) 1X2 (h2h, 3
// outcomes) write→read ponta-a-ponta. Roda em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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

describe("ensureOddsSnapshotsFresh — selection_odds_snapshots write against real Postgres (pglite)", () => {
  it("over_under: writes selection_odds_snapshots (linha 2.5); retorno adapta o par binário", async () => {
    getOddsForSport.mockResolvedValue([totalsEvent()]);
    const now = new Date();

    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];
    const result = await ensureOddsSnapshotsFresh(match, { now });

    // retorno = captura over/under adaptada da tabela genérica pra forma binária
    expect(result).not.toBeNull();
    expect(result!.bookmaker).toBe("Pinnacle");
    expect(result!.overOdd).toBe("1.900");
    expect(result!.underOdd).toBe("1.950");
    expect(result!.capturedAt.getTime()).toBe(now.getTime());

    // tabela genérica: 2 rows (over + under), MESMO captured_at/bookmaker/overround
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
    // captura coerente: ambas as seleções no mesmo captured_at + overround do retorno
    expect(latest!.capturedAt.getTime()).toBe(now.getTime());
    expect(latest!.overroundPct).toBe(result!.overroundPct);
  });

  it("match_result: 1X2 write→read end-to-end, 3 coherent rows, new table only", async () => {
    getOddsForSport.mockResolvedValue([h2hEvent()]);
    const now = new Date();

    const match = (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];
    await ensureOddsSnapshotsFresh(match, { now, markets: [MATCH_RESULT] });

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

    // tabela genérica: 2 rows yes/no, mesmo book/captured_at.
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

    // tabela genérica: por linha, 2 seleções (over/under) com as odds da rung + marketParams.line.
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

// Gate de quota (pre-match-gate.ts): fora do pré-jogo, NENHUMA chamada ao provider
// (featured nem additional); só a última captura gravada volta. Antes do apito, tudo
// igual (inclui a janela de 30min ≤24h e a captura de fechamento do CLV, KO ≤90min).
describe("ensureOddsSnapshotsFresh — gate de pré-jogo (quota)", () => {
  const ALL_MARKETS = [OVER_UNDER, MATCH_RESULT, BTTS];
  const MIN = 60_000;
  let seq = 0;

  async function insertMatch(
    status: (typeof schema.matchStatusEnum.enumValues)[number],
    kickoffAt: Date,
  ) {
    seq += 1;
    const [m] = await realDb
      .insert(schema.matches)
      .values({
        externalId: `ext-gate-${seq}`,
        league: "brasileirao_a",
        // times distintos do jogo principal: nunca casam com os eventos mockados
        homeTeam: `Gate Home ${seq}`,
        awayTeam: `Gate Away ${seq}`,
        kickoffAt,
        status,
      })
      .returning();
    return m;
  }

  async function mainMatch() {
    return (
      await realDb.select().from(schema.matches).where(eq(schema.matches.id, matchIds.id))
    )[0];
  }

  function expectNoProviderCall() {
    expect(getOddsForSport).not.toHaveBeenCalled();
    expect(getEventsForSport).not.toHaveBeenCalled();
    expect(getOddsForEvent).not.toHaveBeenCalled();
  }

  it("jogo já apitado (scheduled stale, kickoff no passado) → nenhuma chamada ao provider", async () => {
    const match = await insertMatch("scheduled", new Date(Date.now() - 10 * MIN));

    const result = await ensureOddsSnapshotsFresh(match, { markets: ALL_MARKETS });

    expectNoProviderCall();
    expect(result).toBeNull(); // nada gravado pra ele
  });

  it("jogo encerrado (finished, kickoff no passado) → nenhuma chamada ao provider", async () => {
    const match = await insertMatch("finished", new Date(Date.now() - 3 * 60 * MIN));

    await ensureOddsSnapshotsFresh(match, { markets: ALL_MARKETS });

    expectNoProviderCall();
  });

  it.each(["live", "finished", "cancelled", "postponed"] as const)(
    "status %s barra mesmo com kickoff no futuro (allowlist: só scheduled)",
    async (status) => {
      const match = await insertMatch(status, new Date(Date.now() + 2 * 60 * MIN));

      const result = await ensureOddsSnapshotsFresh(match, { markets: ALL_MARKETS });

      expectNoProviderCall();
      expect(result).toBeNull();
    },
  );

  it("jogo começado devolve a última captura gravada (read-only), sem refetch mesmo stale", async () => {
    getOddsForSport.mockResolvedValue([totalsEvent()]);
    const match = await mainMatch();
    const before = new Date(KICKOFF.getTime() - 10 * MIN);

    // captura pré-jogo (fecha o mercado a KO−10min)
    const seeded = await ensureOddsSnapshotsFresh(match, { now: before });
    expect(getOddsForSport).toHaveBeenCalledTimes(1);
    expect(seeded).not.toBeNull();

    // 40min depois do apito: a captura está stale (>30min), mas o gate não busca.
    getOddsForSport.mockClear();
    const after = await ensureOddsSnapshotsFresh(match, {
      now: new Date(KICKOFF.getTime() + 40 * MIN),
      markets: ALL_MARKETS,
    });

    expectNoProviderCall();
    expect(after).not.toBeNull();
    expect(after!.capturedAt.getTime()).toBe(before.getTime());
    expect(after!.overOdd).toBe(seeded!.overOdd);
    expect(after!.underOdd).toBe(seeded!.underOdd);
    expect(after!.bookmaker).toBe("Pinnacle");
  });

  it("antes do apito (≤24h): janela de 30min inalterada — 29min reusa, 31min refaz", async () => {
    getOddsForSport.mockResolvedValue([totalsEvent()]);
    const match = await mainMatch();
    const t0 = new Date();

    await ensureOddsSnapshotsFresh(match, { now: t0 });
    expect(getOddsForSport).toHaveBeenCalledTimes(1);

    await ensureOddsSnapshotsFresh(match, { now: new Date(t0.getTime() + 29 * MIN) });
    expect(getOddsForSport).toHaveBeenCalledTimes(1); // fresco → sem crédito

    await ensureOddsSnapshotsFresh(match, { now: new Date(t0.getTime() + 31 * MIN) });
    expect(getOddsForSport).toHaveBeenCalledTimes(2); // stale → refaz
  });

  it("captura de fechamento (CLV): KO−1ms ainda busca; no instante do KO já não", async () => {
    getOddsForSport.mockResolvedValue([totalsEvent()]);
    getEventsForSport.mockResolvedValue([bttsEventListItem()]);
    getOddsForEvent.mockResolvedValue(bttsEvent());
    const match = await mainMatch();

    // KO−1ms, sem captura nenhuma (stale): featured + additional buscam.
    await ensureOddsSnapshotsFresh(match, {
      now: new Date(KICKOFF.getTime() - 1),
      markets: [OVER_UNDER, BTTS],
    });
    expect(getOddsForSport).toHaveBeenCalledTimes(1);
    expect(getOddsForEvent).toHaveBeenCalledTimes(1);

    // No KO exato (e 31min depois, já stale): bloqueado nos dois caminhos.
    getOddsForSport.mockClear();
    getEventsForSport.mockClear();
    getOddsForEvent.mockClear();
    await ensureOddsSnapshotsFresh(match, {
      now: KICKOFF,
      markets: [OVER_UNDER, BTTS],
    });
    await ensureOddsSnapshotsFresh(match, {
      now: new Date(KICKOFF.getTime() + 31 * MIN),
      markets: [OVER_UNDER, BTTS],
    });
    expectNoProviderCall();
  });
});
