// @vitest-environment node
//
// `getInPlayState` (#580, PLAN-580 §5.2) contra Postgres REAL (pglite): janela, cache de
// 60 s na row, terminal, flag, cota, lease, falha, primeira busca, reuso do fixture id e
// coalescência. O provider é falso (`__setLiveStateProviderForTesting`); nenhuma rede.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  afterEach,
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
    }
  ),
}));

const flag = vi.hoisted(() => ({ liveMode: true, throwOnce: false, calls: 0 }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableLiveMode: vi.fn(async () => {
    flag.calls++;
    if (flag.throwOnce) {
      flag.throwOnce = false;
      throw new Error("db down");
    }
    return flag.liveMode;
  }),
}));

// Guarda (§5.3): nenhum caminho ao vivo toca a The Odds API.
const oddsSpies = vi.hoisted(() => ({
  getOddsForSport: vi.fn(),
  getOddsForEvent: vi.fn(),
  getEventsForSport: vi.fn(),
  getOddsProvider: vi.fn(),
}));
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: oddsSpies.getOddsForSport,
  getOddsForEvent: oddsSpies.getOddsForEvent,
  getEventsForSport: oddsSpies.getEventsForSport,
}));
vi.mock("@/lib/providers/odds", () => ({
  getOddsProvider: oddsSpies.getOddsProvider,
}));

import {
  getMatchLiveState,
  saveMatchLiveState,
  type SaveMatchLiveStateInput,
} from "@/lib/db/queries/match-live-states";
import {
  getInPlayState,
  getInPlayStatesForMatches,
  IN_PLAY_WINDOW_AFTER_MS,
  IN_PLAY_WINDOW_BEFORE_MS,
  type InPlayMatch,
} from "@/lib/live/in-play-state";
import { IN_PLAY_ACT_MAX_AGE_MS } from "@/lib/live/freshness";
import {
  __setLiveStateProviderForTesting,
  type LiveStateRequest,
  type NormalizedLiveState,
} from "@/lib/providers/live";

const KICKOFF = new Date("2026-10-15T19:00:00Z");
const at = (ms: number) => new Date(KICKOFF.getTime() + ms);
const MIN = 60_000;

let seq = 0;
async function newMatch(
  status: InPlayMatch["status"] = "scheduled"
): Promise<InPlayMatch> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-inplay-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: KICKOFF,
      status,
    })
    .returning();
  return m;
}

async function seed(
  matchId: string,
  over: Partial<SaveMatchLiveStateInput> = {}
): Promise<void> {
  await saveMatchLiveState({
    matchId,
    providerFixtureId: 555,
    statusShort: "1H",
    elapsed: 20,
    extra: null,
    homeGoals: 0,
    awayGoals: 0,
    homeRed: 0,
    awayRed: 0,
    homePens: null,
    awayPens: null,
    fetchedAt: at(20 * MIN),
    ...over,
  });
}

function providerState(
  over: Partial<NormalizedLiveState> = {}
): NormalizedLiveState {
  return {
    providerFixtureId: 777,
    statusShort: "1H",
    elapsed: 30,
    extra: null,
    goals: { home: 1, away: 0 },
    red: { home: 0, away: 1 },
    penalties: null,
    fetchedAt: at(30 * MIN),
    ...over,
  };
}

type Fake = {
  getLiveState: ReturnType<
    typeof vi.fn<(req: LiveStateRequest) => Promise<NormalizedLiveState | null>>
  >;
  isQuotaLow: ReturnType<typeof vi.fn<() => boolean>>;
};
let fake: Fake;

function installProvider(
  impl: (req: LiveStateRequest) => Promise<NormalizedLiveState | null> = async (
    req
  ) =>
    providerState({
      providerFixtureId: req.providerFixtureId ?? 777,
    })
): Fake {
  const f: Fake = {
    getLiveState: vi.fn(impl),
    isQuotaLow: vi.fn(() => false),
  };
  __setLiveStateProviderForTesting({
    name: "api_football",
    getLiveState: f.getLiveState,
    isQuotaLow: f.isQuotaLow,
  });
  return f;
}

let warn: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
}, 60_000);

afterAll(async () => {
  __setLiveStateProviderForTesting(undefined);
  await client.close();
});

beforeEach(() => {
  flag.liveMode = true;
  flag.throwOnce = false;
  flag.calls = 0;
  fake = installProvider();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  for (const spy of Object.values(oddsSpies))
    expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("getInPlayState: janela [kickoff − 5 min, kickoff + 4h]", () => {
  it("antes da janela: null, sem buscar", async () => {
    const m = await newMatch();
    const now = at(-IN_PLAY_WINDOW_BEFORE_MS - 1);
    expect(await getInPlayState(m, { now })).toBeNull();
    expect(fake.getLiveState).not.toHaveBeenCalled();
  });

  it("na borda de abertura (kickoff − 5 min) já busca", async () => {
    const m = await newMatch();
    fake = installProvider(async () =>
      providerState({
        statusShort: "NS",
        elapsed: null,
        goals: null,
        red: null,
        fetchedAt: at(-IN_PLAY_WINDOW_BEFORE_MS),
      })
    );
    const s = await getInPlayState(m, { now: at(-IN_PLAY_WINDOW_BEFORE_MS) });
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
    // NS sem gols = 0–0 (a fase antes do apito é `pre` de qualquer jeito, matchPhase).
    expect(s).toMatchObject({
      statusShort: "NS",
      minuteLabel: "0'",
      score: { home: 0, away: 0 },
    });
  });

  it("na borda de fechamento (kickoff + 4h) ainda busca", async () => {
    const m = await newMatch();
    await seed(m.id, { statusShort: "ET", elapsed: 105 });
    const now = at(IN_PLAY_WINDOW_AFTER_MS);
    fake = installProvider(async () =>
      providerState({ statusShort: "PEN", fetchedAt: now })
    );
    const s = await getInPlayState(m, { now });
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
    expect(s?.statusShort).toBe("PEN");
  });

  it("depois da janela: só a row terminal, sem buscar", async () => {
    const after = at(IN_PLAY_WINDOW_AFTER_MS + 1);
    const terminal = await newMatch();
    await seed(terminal.id, { statusShort: "FT", elapsed: 90 });
    const stuck = await newMatch();
    await seed(stuck.id, { statusShort: "2H", elapsed: 70 });
    const none = await newMatch();

    expect((await getInPlayState(terminal, { now: after }))?.statusShort).toBe(
      "FT"
    );
    expect(await getInPlayState(stuck, { now: after })).toBeNull();
    expect(await getInPlayState(none, { now: after })).toBeNull();
    expect(fake.getLiveState).not.toHaveBeenCalled();
  });
});

describe("getInPlayState: cache na row", () => {
  it("row fresca (≤ 60 s): devolve sem buscar, com a idade", async () => {
    const m = await newMatch();
    await seed(m.id, {
      elapsed: 47,
      extra: 2,
      homeGoals: 2,
      awayGoals: 1,
      homeRed: 1,
      awayRed: 0,
      homePens: null,
      awayPens: null,
    });
    const s = await getInPlayState(m, { now: at(20 * MIN + 60_000) });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(s).toEqual({
      matchId: m.id,
      statusShort: "1H",
      elapsed: 47,
      extra: 2,
      fetchedAt: at(20 * MIN),
      minuteLabel: "45+2'",
      score: { home: 2, away: 1 },
      red: { home: 1, away: 0 },
      penalties: null,
      ageMs: 60_000,
    });
  });

  it("maxAgeMs maior que 60 s aceita a row sem buscar; o default busca", async () => {
    const m = await newMatch();
    await seed(m.id);
    const now = at(20 * MIN + 90_000);
    const s = await getInPlayState(m, {
      now,
      maxAgeMs: IN_PLAY_ACT_MAX_AGE_MS,
    });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(s?.ageMs).toBe(90_000);

    await getInPlayState(m, { now });
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
  });

  it("row terminal velha: devolve sem buscar", async () => {
    const m = await newMatch();
    await seed(m.id, { statusShort: "FT", elapsed: 90, homeGoals: 3 });
    const s = await getInPlayState(m, { now: at(2 * 60 * MIN) });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(s).toMatchObject({ statusShort: "FT", score: { home: 3, away: 0 } });
  });

  it("DB já terminal (sync): devolve a row sem buscar", async () => {
    const m = await newMatch("finished");
    await seed(m.id, { statusShort: "2H", elapsed: 88 });
    const s = await getInPlayState(m, { now: at(2 * 60 * MIN) });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(s?.statusShort).toBe("2H");
  });
});

describe("getInPlayState: portões antes da busca", () => {
  it("flag desligada: null sem buscar e sem tomar o lease", async () => {
    flag.liveMode = false;
    const m = await newMatch();
    await seed(m.id);
    expect(await getInPlayState(m, { now: at(30 * MIN) })).toBeNull();
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect((await getMatchLiveState(m.id))?.claimedAt).toBeNull();
  });

  it("cota baixa: devolve a row como está, sem lease nem busca", async () => {
    const m = await newMatch();
    await seed(m.id);
    fake.isQuotaLow.mockReturnValue(true);
    const s = await getInPlayState(m, { now: at(30 * MIN) });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(s).toMatchObject({ elapsed: 20, ageMs: 10 * MIN });
    expect((await getMatchLiveState(m.id))?.claimedAt).toBeNull();
  });

  it("cota baixa e sem row: null", async () => {
    const m = await newMatch();
    fake.isQuotaLow.mockReturnValue(true);
    expect(await getInPlayState(m, { now: at(30 * MIN) })).toBeNull();
    expect(fake.getLiveState).not.toHaveBeenCalled();
  });

  it("lease com outra instância: devolve a row velha sem buscar", async () => {
    const m = await newMatch();
    await seed(m.id);
    const now = at(30 * MIN);
    await realDb
      .update(schema.matchLiveStates)
      .set({ claimedAt: new Date(now.getTime() - 5_000) })
      .where(eq(schema.matchLiveStates.matchId, m.id));
    const s = await getInPlayState(m, { now });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(s).toMatchObject({ elapsed: 20, ageMs: 10 * MIN });
  });
});

describe("getInPlayState: busca", () => {
  it("primeira busca de todas: insere a row e solta o lease", async () => {
    const m = await newMatch();
    const now = at(30 * MIN);
    const s = await getInPlayState(m, { now });

    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
    expect(fake.getLiveState.mock.calls[0][0]).toEqual({
      ref: {
        league: "brasileirao_a",
        kickoffAt: KICKOFF.toISOString(),
        homeTeam: "Casa",
        awayTeam: "Fora",
      },
      providerFixtureId: null,
    });
    expect(s).toEqual({
      matchId: m.id,
      statusShort: "1H",
      elapsed: 30,
      extra: null,
      fetchedAt: now,
      minuteLabel: "30'",
      score: { home: 1, away: 0 },
      red: { home: 0, away: 1 },
      penalties: null,
      ageMs: 0,
    });
    const row = await getMatchLiveState(m.id);
    expect(row).toMatchObject({
      providerFixtureId: 777,
      statusShort: "1H",
      elapsed: 30,
      homeGoals: 1,
      awayGoals: 0,
      homeRed: 0,
      awayRed: 1,
      homePens: null,
      awayPens: null,
      fetchedAt: now,
      claimedAt: null,
    });
  });

  it("disputa de pênaltis: grava o placar na row e devolve no estado (#600)", async () => {
    const m = await newMatch();
    const now = at(150 * MIN);
    fake.getLiveState.mockResolvedValueOnce(
      providerState({
        statusShort: "P",
        elapsed: 120,
        goals: { home: 0, away: 0 },
        penalties: { home: 1, away: 2 },
        fetchedAt: now,
      })
    );
    const s = await getInPlayState(m, { now });
    expect(s?.penalties).toEqual({ home: 1, away: 2 });
    expect(await getMatchLiveState(m.id)).toMatchObject({
      statusShort: "P",
      homePens: 1,
      awayPens: 2,
    });
    // Leitura seguinte sai da row.
    const again = await getInPlayState(m, {
      now: new Date(now.getTime() + 1_000),
    });
    expect(again?.penalties).toEqual({ home: 1, away: 2 });
  });

  it("atraso no apito (NS sem gols): placar 0–0 no minuto 0, a row guarda o null cru", async () => {
    const m = await newMatch();
    const now = at(3 * MIN);
    fake = installProvider(async () =>
      providerState({
        statusShort: "NS",
        elapsed: null,
        goals: null,
        red: null,
        fetchedAt: now,
      })
    );
    const s = await getInPlayState(m, { now });
    expect(s).toMatchObject({
      statusShort: "NS",
      minuteLabel: "0'",
      score: { home: 0, away: 0 },
    });
    const row = await getMatchLiveState(m.id);
    expect(row).toMatchObject({ homeGoals: null, awayGoals: null });
    // Relida da row (cache fresco): o mesmo 0–0.
    const again = await getInPlayState(m, { now: at(3 * MIN + 10_000) });
    expect(again?.score).toEqual({ home: 0, away: 0 });
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
  });

  it("1H sem gols do provider: placar segue null (não inventa 0–0)", async () => {
    const m = await newMatch();
    const now = at(30 * MIN);
    fake = installProvider(async () =>
      providerState({ goals: null, fetchedAt: now })
    );
    expect((await getInPlayState(m, { now }))?.score).toBeNull();
  });

  it("fetchedAt = instante da resposta do provider, e a idade sai dele", async () => {
    const m = await newMatch();
    const now = at(30 * MIN);
    fake = installProvider(async () =>
      providerState({ fetchedAt: new Date(now.getTime() - 3_000) })
    );
    const s = await getInPlayState(m, { now });
    expect(s?.ageMs).toBe(3_000);
    expect((await getMatchLiveState(m.id))?.fetchedAt).toEqual(
      new Date(now.getTime() - 3_000)
    );
  });

  it("reaproveita o provider_fixture_id gravado", async () => {
    const m = await newMatch();
    await getInPlayState(m, { now: at(30 * MIN) });
    await getInPlayState(m, { now: at(31 * MIN + 1) });
    expect(fake.getLiveState).toHaveBeenCalledTimes(2);
    expect(fake.getLiveState.mock.calls[1][0].providerFixtureId).toBe(777);
  });

  it("falha do provider: devolve a row velha com a idade e loga", async () => {
    const m = await newMatch();
    await seed(m.id);
    fake = installProvider(async () => null);
    const s = await getInPlayState(m, { now: at(30 * MIN) });
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
    expect(fake.getLiveState.mock.calls[0][0].providerFixtureId).toBe(555);
    expect(s).toMatchObject({ elapsed: 20, ageMs: 10 * MIN });
    const log = JSON.parse(String(warn.mock.calls.at(-1)?.[0]));
    expect(log).toMatchObject({
      scope: "in-play-state",
      event: "fetch_failed",
      matchId: m.id,
      staleAgeMs: 10 * MIN,
    });
    // A row não muda; o lease fica e vence sozinho.
    expect(await getMatchLiveState(m.id)).toMatchObject({
      elapsed: 20,
      fetchedAt: at(20 * MIN),
    });
  });

  it("provider que lança (fora do contrato) também devolve a row velha", async () => {
    const m = await newMatch();
    await seed(m.id);
    fake = installProvider(async () => {
      throw new Error("boom");
    });
    const s = await getInPlayState(m, { now: at(30 * MIN) });
    expect(s?.elapsed).toBe(20);
  });

  it("falha sem row anterior: null", async () => {
    const m = await newMatch();
    fake = installProvider(async () => null);
    expect(await getInPlayState(m, { now: at(30 * MIN) })).toBeNull();
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
  });

  it("duas chamadas concorrentes no mesmo jogo: uma busca só", async () => {
    const m = await newMatch();
    const now = at(30 * MIN);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake = installProvider(async () => {
      await gate;
      return providerState({ fetchedAt: now });
    });
    const both = Promise.all([
      getInPlayState(m, { now }),
      getInPlayState(m, { now }),
    ]);
    release();
    const [a, b] = await both;
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a?.elapsed).toBe(30);
  });

  it("leitura em voo que falha: sai do mapa e a chamada seguinte busca de novo", async () => {
    const m = await newMatch();
    const now = at(30 * MIN);
    flag.throwOnce = true;
    const first = getInPlayState(m, { now });
    const joined = getInPlayState(m, { now });
    await expect(first).rejects.toThrow("db down");
    await expect(joined).rejects.toThrow("db down");
    // As duas dividiram a mesma leitura (coalescência), que falhou antes da busca.
    expect(flag.calls).toBe(1);
    expect(fake.getLiveState).not.toHaveBeenCalled();

    const later = await getInPlayState(m, { now });
    expect(flag.calls).toBe(2);
    expect(fake.getLiveState).toHaveBeenCalledTimes(1);
    expect(later?.elapsed).toBe(30);
  });
});

describe("getInPlayStatesForMatches", () => {
  it("lê as rows em lote, nunca busca, e deixa de fora quem não tem leitura", async () => {
    const withState = await newMatch();
    await seed(withState.id, { statusShort: "HT", elapsed: 45 });
    const leaseOnly = await newMatch();
    await realDb
      .insert(schema.matchLiveStates)
      .values({ matchId: leaseOnly.id, claimedAt: at(30 * MIN) });
    const none = await newMatch();

    const map = await getInPlayStatesForMatches(
      [withState.id, leaseOnly.id, none.id],
      { now: at(50 * MIN) }
    );
    expect([...map.keys()]).toEqual([withState.id]);
    expect(map.get(withState.id)).toMatchObject({
      minuteLabel: "intervalo",
      ageMs: 30 * MIN,
    });
    expect(fake.getLiveState).not.toHaveBeenCalled();
    expect(fake.isQuotaLow).not.toHaveBeenCalled();
  });

  it("lista vazia: mapa vazio", async () => {
    expect((await getInPlayStatesForMatches([])).size).toBe(0);
  });
});
