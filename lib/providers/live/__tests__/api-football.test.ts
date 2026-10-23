import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryCache } from "@/lib/cache/in-memory";
import { classifyStatusShort } from "@/lib/live/phase";
import {
  getLastQuota,
  type ObservedQuota,
} from "@/lib/providers/http/quota-logger";
import {
  ApiFootballLiveStateProvider,
  countRedCards,
  findFixtureForRef,
  isApiFootballQuotaLow,
  toNormalizedLiveState,
} from "@/lib/providers/live/api-football";
import {
  __setLiveStateProviderForTesting,
  getLiveStateProvider,
  type LiveStateProvider,
} from "@/lib/providers/live";
import {
  getFixtureById,
  getFixtureLive,
  getFixturesRaw,
  LIVE_FIXTURE_CACHE_TTL_MS,
  RAW_FIXTURES_MAX_IDS,
} from "@/lib/providers/sports-data/api-football/adapter";
import {
  FixtureEnvelopeSchema,
  FixtureItemSchema,
  type ApiFootballFixture,
} from "@/lib/providers/sports-data/api-football/schemas";
import type { FixtureRef } from "@/lib/providers/sports-data/types";

import realLive from "./fixtures/api-football-1640556-2h-red-card.json";

// ─── Payload de /fixtures?id= ────────────────────────────────────────────────
// INFERIDO DA DOCUMENTAÇÃO da API-Football v3 (exemplo de resposta de `/fixtures` com
// `id`: `status.extra`, `events`, `lineups`, `statistics`, `players` no mesmo item).
// Serve pros casos montados à mão (variações de status/eventos). O formato foi conferido
// contra o payload REAL em `fixtures/api-football-1640556-2h-red-card.json` (#600),
// testado em "payload real" no fim deste arquivo.
function inferredLiveItem(): Record<string, unknown> {
  return {
    fixture: {
      id: 1208021,
      referee: "Wilton Pereira Sampaio, Brazil",
      timezone: "UTC",
      date: "2026-10-15T22:00:00+00:00",
      timestamp: Math.floor(Date.parse("2026-10-15T22:00:00Z") / 1000),
      periods: { first: 1792101600, second: 1792105200 },
      venue: { id: 204, name: "Estádio do Maracanã", city: "Rio de Janeiro" },
      status: { long: "Second Half", short: "2H", elapsed: 63, extra: null },
    },
    league: {
      id: 71,
      name: "Serie A",
      country: "Brazil",
      logo: "https://media.api-sports.io/football/leagues/71.png",
      flag: "https://media.api-sports.io/flags/br.svg",
      season: 2026,
      round: "Regular Season - 29",
      standings: true,
    },
    teams: {
      home: {
        id: 127,
        name: "Flamengo",
        logo: "https://media.api-sports.io/football/teams/127.png",
        winner: true,
      },
      away: {
        id: 121,
        name: "Palmeiras",
        logo: "https://media.api-sports.io/football/teams/121.png",
        winner: false,
      },
    },
    goals: { home: 1, away: 0 },
    score: {
      halftime: { home: 1, away: 0 },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    events: [
      {
        time: { elapsed: 23, extra: null },
        team: { id: 127, name: "Flamengo", logo: "x" },
        player: { id: 10, name: "Pedro" },
        assist: { id: 11, name: "Arrascaeta" },
        type: "Goal",
        detail: "Normal Goal",
        comments: null,
      },
      {
        time: { elapsed: 31, extra: null },
        team: { id: 121, name: "Palmeiras", logo: "x" },
        player: { id: 20, name: "Gómez" },
        assist: { id: null, name: null },
        type: "Card",
        detail: "Yellow Card",
        comments: "Foul",
      },
      {
        time: { elapsed: 45, extra: 2 },
        team: { id: 121, name: "Palmeiras", logo: "x" },
        player: { id: 21, name: "Zé Rafael" },
        assist: { id: null, name: null },
        type: "Card",
        detail: "Red Card",
        comments: "Violent conduct",
      },
      {
        time: { elapsed: 58, extra: null },
        team: { id: 127, name: "Flamengo", logo: "x" },
        player: { id: 12, name: "Gerson" },
        assist: { id: 13, name: "Bruno Henrique" },
        type: "subst",
        detail: "Substitution 1",
        comments: null,
      },
    ],
    lineups: [],
    statistics: [],
    players: [],
  };
}

function inferredEnvelope(items: unknown[]): unknown {
  return {
    get: "fixtures",
    parameters: { id: "1208021" },
    errors: [],
    results: items.length,
    paging: { current: 1, total: 1 },
    response: items,
  };
}

function parseItem(raw: unknown): ApiFootballFixture {
  return FixtureItemSchema.parse(raw);
}

function card(
  teamId: number | null,
  detail: string,
  player: { id?: number | null; name?: string | null } = { id: 99, name: "X" }
): Record<string, unknown> {
  return {
    time: { elapsed: 70, extra: null },
    team: { id: teamId, name: "T" },
    player,
    type: "Card",
    detail,
  };
}

function withEvents(events: unknown[] | undefined): ApiFootballFixture {
  const raw = inferredLiveItem();
  if (events === undefined) delete raw.events;
  else raw.events = events;
  return parseItem(raw);
}

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: "2026-10-15T22:00:00.000Z",
  homeTeam: "CR Flamengo",
  awayTeam: "SE Palmeiras",
};

const FETCHED_AT = new Date("2026-10-15T23:10:00.000Z");

// ─── Zod: schema tolerante ───────────────────────────────────────────────────

describe("FixtureEnvelopeSchema com o payload ao vivo (inferido da documentação)", () => {
  it("status.extra fora do formato vira null sem derrubar o envelope", () => {
    const item = inferredLiveItem();
    const fixture = item.fixture as Record<string, unknown>;
    for (const extra of ["2", 2.5]) {
      const raw = {
        ...item,
        fixture: {
          ...fixture,
          status: { long: "Second Half", short: "2H", elapsed: 45, extra },
        },
      };
      const env = FixtureEnvelopeSchema.parse(
        inferredEnvelope([raw, inferredLiveItem()])
      );
      expect(env.response).toHaveLength(2);
      expect(env.response[0]!.fixture.status.extra).toBeNull();
    }
  });

  it("aceita o item completo (chaves extras de lineups/statistics/players descartadas)", () => {
    const env = FixtureEnvelopeSchema.parse(
      inferredEnvelope([inferredLiveItem()])
    );
    const f = env.response[0]!;
    expect(f.fixture.status).toEqual({
      long: "Second Half",
      short: "2H",
      elapsed: 63,
      extra: null,
    });
    expect(f.events).toHaveLength(4);
    expect(f.events?.[2]?.time).toEqual({ elapsed: 45, extra: 2 });
  });

  it("status.extra ausente ou null → extra null no estado", () => {
    const raw = inferredLiveItem();
    (raw.fixture as { status: Record<string, unknown> }).status = {
      long: "First Half",
      short: "1H",
      elapsed: 45,
    };
    expect(toNormalizedLiveState(parseItem(raw), FETCHED_AT).extra).toBeNull();

    const withNull = inferredLiveItem();
    expect(
      toNormalizedLiveState(parseItem(withNull), FETCHED_AT).extra
    ).toBeNull();
  });

  it("status.extra presente (45+2') vira extra 2", () => {
    const raw = inferredLiveItem();
    (raw.fixture as { status: Record<string, unknown> }).status = {
      long: "First Half",
      short: "1H",
      elapsed: 45,
      extra: 2,
    };
    const s = toNormalizedLiveState(parseItem(raw), FETCHED_AT);
    expect(s.elapsed).toBe(45);
    expect(s.extra).toBe(2);
  });

  it("events ausente não derruba o parse e vira red null", () => {
    const f = withEvents(undefined);
    expect(f.events).toBeUndefined();
    expect(toNormalizedLiveState(f, FETCHED_AT).red).toBeNull();
  });

  it("evento malformado descarta só os eventos (red null), não o fixture", () => {
    const raw = inferredLiveItem();
    raw.events = [{ time: { elapsed: "x" }, type: 42 }];
    const env = FixtureEnvelopeSchema.safeParse(inferredEnvelope([raw]));
    expect(env.success).toBe(true);
    const f = env.data!.response[0]!;
    expect(f.events).toBeUndefined();
    expect(f.goals).toEqual({ home: 1, away: 0 });
    expect(toNormalizedLiveState(f, FETCHED_AT).red).toBeNull();
  });
});

// ─── Normalização ────────────────────────────────────────────────────────────

describe("toNormalizedLiveState", () => {
  it("mapeia id, status, minuto, placar, expulsões e fetchedAt", () => {
    expect(
      toNormalizedLiveState(parseItem(inferredLiveItem()), FETCHED_AT)
    ).toEqual({
      providerFixtureId: 1208021,
      statusShort: "2H",
      elapsed: 63,
      extra: null,
      goals: { home: 1, away: 0 },
      red: { home: 0, away: 1 },
      fetchedAt: FETCHED_AT,
    });
  });

  it("antes do apito (goals null) → goals null", () => {
    const raw = inferredLiveItem();
    raw.goals = { home: null, away: null };
    (raw.fixture as { status: Record<string, unknown> }).status = {
      long: "Not Started",
      short: "NS",
      elapsed: null,
    };
    raw.events = [];
    const s = toNormalizedLiveState(parseItem(raw), FETCHED_AT);
    expect(s.goals).toBeNull();
    expect(s.elapsed).toBeNull();
    expect(s.red).toEqual({ home: 0, away: 0 });
  });
});

describe("countRedCards", () => {
  it("vermelho direto e segundo amarelo contam; amarelo não", () => {
    const f = withEvents([
      card(127, "Yellow Card", { id: 1, name: "A" }),
      card(127, "Red Card", { id: 2, name: "B" }),
      card(121, "Second Yellow card", { id: 3, name: "C" }),
      card(121, "Yellow Card", { id: 4, name: "D" }),
    ]);
    expect(countRedCards(f)).toEqual({ home: 1, away: 1 });
  });

  it("sem diferenciar maiúsculas no detail nem no type", () => {
    const f = withEvents([
      { ...card(127, "RED CARD", { id: 1 }), type: "card" },
      card(121, "second yellow Card", { id: 2 }),
    ]);
    expect(countRedCards(f)).toEqual({ home: 1, away: 1 });
  });

  it("segundo amarelo + vermelho do MESMO jogador contam uma expulsão", () => {
    const f = withEvents([
      card(121, "Second Yellow card", { id: 7, name: "Gómez" }),
      card(121, "Red Card", { id: 7, name: "Gómez" }),
    ]);
    expect(countRedCards(f)).toEqual({ home: 0, away: 1 });
  });

  it("mesmo jogador sem id dedupa pelo nome; sem identidade conta cada evento", () => {
    const byName = withEvents([
      card(127, "Second Yellow card", { id: null, name: "Pedro" }),
      card(127, "Red Card", { id: null, name: "Pedro" }),
    ]);
    expect(countRedCards(byName)).toEqual({ home: 1, away: 0 });

    const anonymous = withEvents([
      card(127, "Red Card", { id: null, name: null }),
      card(127, "Red Card", { id: null, name: null }),
    ]);
    expect(countRedCards(anonymous)).toEqual({ home: 2, away: 0 });
  });

  it("dois jogadores do mesmo time expulsos = 2", () => {
    const f = withEvents([
      card(127, "Red Card", { id: 1 }),
      card(127, "Red Card", { id: 2 }),
    ]);
    expect(countRedCards(f)).toEqual({ home: 2, away: 0 });
  });

  it("vermelho que não dá pra atribuir a nenhum time → null (sem dados)", () => {
    expect(countRedCards(withEvents([card(999, "Red Card")]))).toBeNull();
    expect(countRedCards(withEvents([card(null, "Red Card")]))).toBeNull();
  });

  it("amarelo sem time é ignorado (não é expulsão)", () => {
    expect(countRedCards(withEvents([card(null, "Yellow Card")]))).toEqual({
      home: 0,
      away: 0,
    });
  });

  it("events ausente → null; lista vazia → 0 × 0", () => {
    expect(countRedCards(withEvents(undefined))).toBeNull();
    expect(countRedCards(withEvents([]))).toEqual({ home: 0, away: 0 });
  });
});

describe("findFixtureForRef", () => {
  it("casa pelos nomes canônicos (mesmo padrão de getFixtureResult)", () => {
    const other = inferredLiveItem();
    (other.fixture as { id: number }).id = 555;
    (other.teams as Record<string, unknown>).home = { id: 1, name: "Santos" };
    const fixtures = [parseItem(other), parseItem(inferredLiveItem())];
    expect(findFixtureForRef(fixtures, REF)?.fixture.id).toBe(1208021);
    expect(
      findFixtureForRef(fixtures, { ...REF, awayTeam: "Botafogo FR" })
    ).toBeUndefined();
  });
});

// ─── Freio de cota ───────────────────────────────────────────────────────────

function quota(
  remaining: number | null,
  limit: number | null,
  observedAt: string
): ObservedQuota {
  return {
    dailyRemaining: remaining,
    dailyLimit: limit,
    perMinuteRemaining: null,
    monthlyRemaining: null,
    monthlyUsed: null,
    monthlyLimit: null,
    observedAt: new Date(observedAt),
  };
}

describe("isApiFootballQuotaLow", () => {
  it("sem leitura nenhuma → false", () => {
    expect(isApiFootballQuotaLow(() => null)).toBe(false);
  });

  it("abaixo de 5% do limite diário → true; 5% ou mais → false", () => {
    const low = quota(374, 7500, "2026-10-15T23:00:00Z");
    const ok = quota(375, 7500, "2026-10-15T23:00:00Z");
    const now = new Date("2026-10-15T23:05:00Z");
    expect(
      isApiFootballQuotaLow(
        (p) => (p === "api-football-live" ? low : null),
        now
      )
    ).toBe(true);
    expect(
      isApiFootballQuotaLow((p) => (p === "api-football" ? ok : null), now)
    ).toBe(false);
  });

  it("vale a leitura mais recente entre o cliente ao vivo e o compartilhado", () => {
    const olderLow = quota(10, 7500, "2026-10-15T22:00:00Z");
    const newerOk = quota(5000, 7500, "2026-10-15T23:00:00Z");
    const now = new Date("2026-10-15T23:05:00Z");
    expect(
      isApiFootballQuotaLow(
        (p) => (p === "api-football-live" ? olderLow : newerOk),
        now
      )
    ).toBe(false);
    expect(
      isApiFootballQuotaLow(
        (p) => (p === "api-football-live" ? newerOk : olderLow),
        now
      )
    ).toBe(false);
    const newerLow = quota(10, 7500, "2026-10-15T23:30:00Z");
    expect(
      isApiFootballQuotaLow(
        (p) => (p === "api-football" ? newerLow : newerOk),
        new Date("2026-10-15T23:31:00Z")
      )
    ).toBe(true);
  });

  it("leitura baixa velha ou de outro dia UTC não tranca o freio", () => {
    const low = quota(300, 7500, "2026-10-15T23:50:00Z");
    const read = (p: string) => (p === "api-football-live" ? low : null);
    expect(isApiFootballQuotaLow(read, new Date("2026-10-15T23:55:00Z"))).toBe(
      true
    );
    // A cota diária zera à meia-noite UTC.
    expect(isApiFootballQuotaLow(read, new Date("2026-10-16T00:01:00Z"))).toBe(
      false
    );
    // Mais de 15 min sem header novo.
    const earlier = quota(300, 7500, "2026-10-15T12:00:00Z");
    expect(
      isApiFootballQuotaLow(
        (p) => (p === "api-football-live" ? earlier : null),
        new Date("2026-10-15T12:16:00Z")
      )
    ).toBe(false);
  });

  it("sem restante ou sem limite no header → false (não freia às cegas)", () => {
    expect(
      isApiFootballQuotaLow(() => quota(null, 7500, "2026-10-15T23:00:00Z"))
    ).toBe(false);
    expect(
      isApiFootballQuotaLow(() => quota(1, null, "2026-10-15T23:00:00Z"))
    ).toBe(false);
  });
});

// ─── Provider (dependências injetadas) ───────────────────────────────────────

type ProviderDeps = NonNullable<
  ConstructorParameters<typeof ApiFootballLiveStateProvider>[0]
>;

describe("ApiFootballLiveStateProvider.getLiveState", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function provider(over: ProviderDeps = {}) {
    const fetchLive = vi.fn(async (_id: number) => ({
      fixture: parseItem(inferredLiveItem()) as ApiFootballFixture | undefined,
      fetchedAt: FETCHED_AT,
    }));
    const fixturesByDate = vi.fn(
      async (_date: string, _league: number, _season: number) => [
        parseItem(inferredLiveItem()),
      ]
    );
    const p = new ApiFootballLiveStateProvider({
      fetchLive,
      fixturesByDate,
      readQuota: () => null,
      ceilingMs: 1_000,
      ...over,
    });
    return { p, fetchLive, fixturesByDate };
  }

  it("1ª vez: resolve o id por data UTC + liga + temporada e busca por id", async () => {
    const { p, fetchLive, fixturesByDate } = provider();
    const s = await p.getLiveState({ ref: REF });
    expect(fixturesByDate).toHaveBeenCalledWith("2026-10-15", 71, 2026);
    expect(fetchLive).toHaveBeenCalledWith(1208021);
    expect(s).toMatchObject({
      providerFixtureId: 1208021,
      statusShort: "2H",
      goals: { home: 1, away: 0 },
      red: { home: 0, away: 1 },
      fetchedAt: FETCHED_AT,
    });
  });

  it("com o id já resolvido não chama a busca por data", async () => {
    const { p, fetchLive, fixturesByDate } = provider();
    await p.getLiveState({ ref: REF, providerFixtureId: 1208021 });
    expect(fixturesByDate).not.toHaveBeenCalled();
    expect(fetchLive).toHaveBeenCalledWith(1208021);
  });

  it("jogo não encontrado no dia → null com log, sem busca por id", async () => {
    const { p, fetchLive } = provider({ fixturesByDate: async () => [] });
    await expect(p.getLiveState({ ref: REF })).resolves.toBeNull();
    expect(fetchLive).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fixture_not_resolved")
    );
  });

  it("id sem fixture na resposta → null", async () => {
    const { p } = provider({
      fetchLive: async () => ({ fixture: undefined, fetchedAt: FETCHED_AT }),
    });
    await expect(
      p.getLiveState({ ref: REF, providerFixtureId: 1 })
    ).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fixture_not_found")
    );
  });

  it("erro do provider → null com log estruturado (nunca lança)", async () => {
    const { p } = provider({
      fetchLive: async () => {
        throw new Error("HTTP 500 on /fixtures");
      },
    });
    await expect(
      p.getLiveState({ ref: REF, providerFixtureId: 1 })
    ).resolves.toBeNull();
    const line = JSON.parse(String(errorSpy.mock.calls[0]![0]));
    expect(line).toMatchObject({
      scope: "live-state",
      provider: "api-football",
      error: "fetch_failed",
      providerFixtureId: 1,
      homeTeam: "CR Flamengo",
    });
  });

  it("teto de tempo estourado → null com error ceiling", async () => {
    const { p } = provider({
      fetchLive: () => new Promise<never>(() => {}),
      ceilingMs: 10,
    });
    await expect(
      p.getLiveState({ ref: REF, providerFixtureId: 1 })
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"error":"ceiling"')
    );
  });

  it("cota abaixo de 5% → null sem buscar", async () => {
    // Leitura "de agora": o freio ignora leitura com mais de 15 min (relógio real).
    const low = quota(100, 7500, new Date().toISOString());
    const { p, fetchLive, fixturesByDate } = provider({ readQuota: () => low });
    expect(p.isQuotaLow()).toBe(true);
    await expect(p.getLiveState({ ref: REF })).resolves.toBeNull();
    expect(fetchLive).not.toHaveBeenCalled();
    expect(fixturesByDate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("quota_low"));
  });
});

describe("getLiveStateProvider", () => {
  afterEach(() => __setLiveStateProviderForTesting(undefined));

  it("memoiza o provider da API-Football e aceita troca em teste", () => {
    const a = getLiveStateProvider();
    expect(a).toBeInstanceOf(ApiFootballLiveStateProvider);
    expect(getLiveStateProvider()).toBe(a);
    const fake: LiveStateProvider = {
      name: "api_football",
      isQuotaLow: () => false,
      getLiveState: async () => null,
    };
    __setLiveStateProviderForTesting(fake);
    expect(getLiveStateProvider()).toBe(fake);
    __setLiveStateProviderForTesting(undefined);
    expect(getLiveStateProvider()).toBeInstanceOf(ApiFootballLiveStateProvider);
  });
});

// ─── adapter.getFixtureLive (fetch mockado; nenhuma chamada real) ────────────

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("getFixtureLive", () => {
  const ORIGINAL_KEY = process.env.API_FOOTBALL_KEY;
  // Relógio avançando por teste: o throttle do cliente é de módulo e lê Date.now.
  let clock = Date.parse("2026-10-15T23:00:00.000Z");
  const liveKey = (id: number) =>
    `sports-data:api-football-live:fixtures:id:${id}`;
  const IDS = [1208021, 1208022, 1208023];

  beforeEach(async () => {
    process.env.API_FOOTBALL_KEY = "test-key";
    vi.useFakeTimers();
    clock += 5 * 60 * 1000;
    vi.setSystemTime(new Date(clock));
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const id of IDS) {
      await inMemoryCache.delete(liveKey(id));
      await inMemoryCache.delete(`sports-data:api-football:fixtures:id:${id}`);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (ORIGINAL_KEY === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = ORIGINAL_KEY;
  });

  it("busca /fixtures?id= pelo cliente ao vivo, com a chave e os headers de cota", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(inferredEnvelope([inferredLiveItem()]), {
        "x-ratelimit-requests-remaining": "7000",
        "x-ratelimit-requests-limit": "7500",
      })
    );
    const out = await getFixtureLive(1208021);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.pathname).toBe("/fixtures");
    expect(url.searchParams.get("id")).toBe("1208021");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-apisports-key"]).toBe(
      "test-key"
    );
    expect(out.fixture?.fixture.id).toBe(1208021);
    expect(out.fetchedAt.getTime()).toBe(clock);
    expect(getLastQuota("api-football-live")).toMatchObject({
      dailyRemaining: 7000,
      dailyLimit: 7500,
    });
  });

  it("cache em memória curto (≤ 15 s): junta rajadas e preserva o fetchedAt da resposta", async () => {
    expect(LIVE_FIXTURE_CACHE_TTL_MS).toBeLessThanOrEqual(15_000);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        jsonResponse(inferredEnvelope([inferredLiveItem()]))
      );

    const first = await getFixtureLive(1208022);
    vi.setSystemTime(new Date(clock + 10_000));
    const second = await getFixtureLive(1208022);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second.fetchedAt).toEqual(first.fetchedAt);

    vi.setSystemTime(new Date(clock + LIVE_FIXTURE_CACHE_TTL_MS + 1));
    const third = await getFixtureLive(1208022);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(third.fetchedAt.getTime()).toBe(
      clock + LIVE_FIXTURE_CACHE_TTL_MS + 1
    );
  });

  it("chamadas concorrentes dividem uma request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        jsonResponse(inferredEnvelope([inferredLiveItem()]))
      );
    await Promise.all([getFixtureLive(1208023), getFixtureLive(1208023)]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("chave de cache própria: não reaproveita o cache de 15 min de getFixtureById", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        jsonResponse(inferredEnvelope([inferredLiveItem()]))
      );
    await getFixtureById(1208021);
    await getFixtureLive(1208021);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("HTTP 500 rejeita sem retry (o provider vira null)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("boom", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getFixtureLive(1208021)).rejects.toThrow(/HTTP 500/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── adapter.getFixturesRaw (probe do #600; fetch mockado) ───────────────────

describe("getFixturesRaw", () => {
  const ORIGINAL_KEY = process.env.API_FOOTBALL_KEY;
  let clock = Date.parse("2026-10-22T20:00:00.000Z");

  beforeEach(() => {
    process.env.API_FOOTBALL_KEY = "test-key";
    vi.useFakeTimers();
    clock += 5 * 60 * 1000;
    vi.setSystemTime(new Date(clock));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (ORIGINAL_KEY === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = ORIGINAL_KEY;
  });

  it("1 id → `id=`, corpo cru sem Zod e só os headers x-ratelimit*", async () => {
    const body = { errors: [], response: [{ cru: true }] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(body, {
        "x-ratelimit-requests-remaining": "7000",
        "x-ratelimit-requests-limit": "7500",
        "set-cookie": "x=1",
      })
    );
    const out = await getFixturesRaw([1208021]);
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.pathname).toBe("/fixtures");
    expect(url.searchParams.get("id")).toBe("1208021");
    expect(url.searchParams.has("ids")).toBe(false);
    expect(out.body).toEqual(body);
    expect(out.statusCode).toBe(200);
    expect(out.quotaHeaders).toEqual({
      "x-ratelimit-requests-remaining": "7000",
      "x-ratelimit-requests-limit": "7500",
    });
  });

  it("corpo que não é JSON volta em bodyText em vez de lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>gateway</html>", { status: 200 })
    );
    const out = await getFixturesRaw([1208021]);
    expect(out.body).toBeNull();
    expect(out.bodyText).toBe("<html>gateway</html>");
  });

  it("vários ids → `ids=a-b-c`; vazio ou acima do teto lança sem buscar", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ response: [] }));
    await getFixturesRaw([1, 2, 3]);
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.searchParams.get("ids")).toBe("1-2-3");
    expect(url.searchParams.has("id")).toBe(false);

    await expect(getFixturesRaw([])).rejects.toThrow();
    const tooMany = Array.from(
      { length: RAW_FIXTURES_MAX_IDS + 1 },
      (_, i) => i + 1
    );
    await expect(getFixturesRaw(tooMany)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Payload real gravado num jogo ao vivo (#600) ─────────────────────────────

describe("payload real: Flamengo x Estudiantes, 2H aos 60', expulsão aos 50'", () => {
  const ORIGINAL_KEY = process.env.API_FOOTBALL_KEY;
  const ID = realLive.item.fixture.id;
  const liveKey = `sports-data:api-football-live:fixtures:id:${ID}`;

  beforeEach(async () => {
    process.env.API_FOOTBALL_KEY = "test-key";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(realLive.probedAt));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await inMemoryCache.delete(liveKey);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await inMemoryCache.delete(liveKey);
    if (ORIGINAL_KEY === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = ORIGINAL_KEY;
  });

  it("o schema aceita o item e o estado normalizado bate com o jogo", () => {
    const env = FixtureEnvelopeSchema.parse(inferredEnvelope([realLive.item]));
    const f = env.response[0]!;
    const s = toNormalizedLiveState(f, FETCHED_AT);
    expect(s).toEqual({
      providerFixtureId: 1640556,
      statusShort: "2H",
      elapsed: 60,
      extra: null,
      goals: { home: 0, away: 0 },
      red: { home: 0, away: 1 },
      fetchedAt: FETCHED_AT,
    });
    expect(classifyStatusShort(s.statusShort)).toBe("in_play");
  });

  it('segundo amarelo chega como "Red Card" e a contagem bate com statistics', () => {
    const f = parseItem(realLive.item);
    const cards = (f.events ?? []).filter((e) => e.type === "Card");
    expect(cards.map((e) => e.detail)).toEqual([
      "Yellow Card",
      "Yellow Card",
      "Red Card",
      "Yellow Card",
    ]);
    // O "Red Card" é de quem já tinha amarelo: segundo amarelo, não vermelho direto.
    const red = cards.find((e) => e.detail === "Red Card")!;
    expect(
      cards.some(
        (e) =>
          e.detail === "Yellow Card" &&
          e.player?.id === red.player?.id &&
          (e.time.elapsed ?? 0) < (red.time.elapsed ?? 0)
      )
    ).toBe(true);
    const statRed = (teamId: number) =>
      realLive.item.statistics
        .find((t) => t.team.id === teamId)!
        .statistics.find((x) => x.type === "Red Cards")!.value;
    expect(countRedCards(f)).toEqual({
      home: statRed(f.teams.home.id),
      away: statRed(f.teams.away.id),
    });
  });

  it("os headers de cota reais são os que o freio lê", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(inferredEnvelope([realLive.item]), realLive.quotaHeaders)
    );
    const out = await getFixtureLive(ID);
    expect(out.fixture?.fixture.status.short).toBe("2H");
    expect(getLastQuota("api-football-live")).toMatchObject({
      dailyRemaining: 7445,
      dailyLimit: 7500,
    });
  });
});
