// @vitest-environment node
//
// Settlement das pernas de "aposta livre" (ADR 0036) contra Postgres REAL via pglite.
// Roda as migrations reais 1x, semeia bet_slip + bet_leg (exact_score, settleable),
// injeta um provider mockado de placar e roda settleUserBetLegs com as QUERIES REAIS.
// Cobre: won/lost, ET/null-regulationScore → skipped (compare usa SÓ 90'), perna
// não-settleable NUNCA liquida, e idempotência (2ª run = no-op). Espelha
// settle-palpites.pglite.test.ts. Roda em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
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
    },
  ),
}));

import {
  __setSportsDataProviderForTesting,
} from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settleUserBetLegs } from "@/lib/settlement/settle-user-bets";

const ids: { userId: string } = {} as never;

const KICKOFF = new Date("2026-05-15T19:00:00Z");
const NOW = new Date("2026-05-16T00:00:00Z");

async function seedMatch(externalId: string): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId,
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: KICKOFF,
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

async function seedSlip(matchId: string): Promise<string> {
  const [s] = await realDb
    .insert(schema.betSlips)
    .values({
      matchId,
      userId: ids.userId,
      rawInput: "Flamengo 2 a 1, odd 9",
      parseAiCallId: null,
    })
    .returning({ id: schema.betSlips.id });
  return s.id;
}

async function seedLeg(args: {
  slipId: string;
  kind?: (typeof schema.betLegKindEnum.enumValues)[number];
  params: schema.BetLegParams;
  settleable?: boolean;
}): Promise<string> {
  const [l] = await realDb
    .insert(schema.betLegs)
    .values({
      slipId: args.slipId,
      kind: args.kind ?? "exact_score",
      params: args.params,
      userOdd: "9.000",
      modelProbPct: "8.00",
      gradeSource: "scoreline_model",
      gradeStatus: "graded",
      settleable: args.settleable ?? true,
    })
    .returning({ id: schema.betLegs.id });
  return l.id;
}

// Semeia uma perna exact_score settleable num slip novo. Devolve o legId.
async function seedExactScoreLeg(
  externalId: string,
  params: { home: number; away: number },
): Promise<string> {
  const matchId = await seedMatch(externalId);
  const slipId = await seedSlip(matchId);
  return seedLeg({ slipId, kind: "exact_score", params, settleable: true });
}

function installProvider(
  resultFor: (ref: FixtureRef) => NormalizedFixtureResult | undefined,
): { getFixtureResult: ReturnType<typeof vi.fn> } {
  const getFixtureResult = vi.fn(async (ref: FixtureRef) => resultFor(ref));
  __setSportsDataProviderForTesting({
    getFixtureResult,
  } as unknown as SportsDataProvider);
  return { getFixtureResult };
}

const finished = (home: number, away: number): NormalizedFixtureResult => ({
  status: "finished",
  regulationScore: { home, away },
});

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "bet-settle@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.betLegOutcomes);
  await realDb.delete(schema.betLegs);
  await realDb.delete(schema.betSlips);
  await realDb.delete(schema.matches);
});

afterEach(() => {
  __setSportsDataProviderForTesting(undefined);
  vi.restoreAllMocks();
});

type OutcomeRow = typeof schema.betLegOutcomes.$inferSelect;

async function outcomesByLeg(): Promise<Map<string, OutcomeRow>> {
  const rows = await realDb.select().from(schema.betLegOutcomes);
  return new Map(rows.map((r) => [r.legId, r]));
}

describe("settleUserBetLegs — placar exato", () => {
  it("hit: perna 2-1 sobre 2-1 → outcome won, resultData estreito", async () => {
    const id = await seedExactScoreLeg("ext-hit", { home: 2, away: 1 });
    installProvider(() => finished(2, 1));

    const s = await settleUserBetLegs(NOW);
    expect(s.considered).toBe(1);
    expect(s.settled).toBe(1);
    expect(s.byResult).toEqual({ won: 1, lost: 0 });

    const out = (await outcomesByLeg()).get(id)!;
    expect(out.result).toBe("won");
    expect(out.resultData).toEqual({ homeScore: 2, awayScore: 1, totalGoals: 3 });
  });

  it("miss: perna 2-1 sobre 0-0 → outcome lost", async () => {
    const id = await seedExactScoreLeg("ext-miss", { home: 2, away: 1 });
    installProvider(() => finished(0, 0));

    const s = await settleUserBetLegs(NOW);
    expect(s.settled).toBe(1);
    expect(s.byResult).toEqual({ won: 0, lost: 1 });
    expect((await outcomesByLeg()).get(id)!.result).toBe("lost");
  });

  it("4-1 liquida won (SEM grade 0-3 — reusa a regra pura de palpite verbatim)", async () => {
    const id = await seedExactScoreLeg("ext-4-1", { home: 4, away: 1 });
    installProvider(() => finished(4, 1));

    const s = await settleUserBetLegs(NOW);
    expect(s.settled).toBe(1);
    expect((await outcomesByLeg()).get(id)!.result).toBe("won");
  });
});

describe("settleUserBetLegs — prefer skip over silent wrong settle", () => {
  it("ET: regulationScore null → skipped, NENHUM outcome", async () => {
    const id = await seedExactScoreLeg("ext-et", { home: 2, away: 1 });
    installProvider(() => ({ status: "finished", regulationScore: null }));

    const s = await settleUserBetLegs(NOW);
    expect(s.considered).toBe(1);
    expect(s.settled).toBe(0);
    expect(s.skipped).toBe(1);
    expect((await outcomesByLeg()).has(id)).toBe(false);
  });

  it("jogo não-finalizado (live) → skipped, nenhum outcome", async () => {
    const id = await seedExactScoreLeg("ext-live", { home: 1, away: 1 });
    installProvider(() => ({
      status: "live",
      regulationScore: { home: 1, away: 1 },
    }));

    const s = await settleUserBetLegs(NOW);
    expect(s.settled).toBe(0);
    expect(s.skipped).toBe(1);
    expect((await outcomesByLeg()).has(id)).toBe(false);
  });

  it("perna settleable=false NUNCA liquida: fora do pending set, zero outcome", async () => {
    const matchId = await seedMatch("ext-non-settleable");
    const slipId = await seedSlip(matchId);
    const legId = await seedLeg({
      slipId,
      kind: "exact_score",
      params: { home: 2, away: 1 },
      settleable: false,
    });
    installProvider(() => finished(2, 1));

    const s = await settleUserBetLegs(NOW);
    expect(s.considered).toBe(0);
    expect((await outcomesByLeg()).has(legId)).toBe(false);
  });
});

describe("settleUserBetLegs — idempotência", () => {
  it("2ª run no mesmo jogo → considered=0, row inalterada", async () => {
    const id = await seedExactScoreLeg("ext-idem", { home: 2, away: 1 });
    installProvider(() => finished(2, 1));

    const first = await settleUserBetLegs(NOW);
    expect(first.settled).toBe(1);
    const before = (await outcomesByLeg()).get(id)!;

    const second = await settleUserBetLegs(NOW);
    expect(second.considered).toBe(0);
    expect(second.settled).toBe(0);
    const after = (await outcomesByLeg()).get(id)!;
    expect(after).toEqual(before);
  });
});

// ── Fase 2: kinds de mercado + 1º tempo + event-backed ───────────────────────
import type { NormalizedFixtureEvents } from "@/lib/providers/sports-data/types";

function installProviderFull(
  result: NormalizedFixtureResult,
  events?: NormalizedFixtureEvents,
): { getFixtureEvents: ReturnType<typeof vi.fn> } {
  const getFixtureResult = vi.fn(async () => result);
  const getFixtureEvents = vi.fn(async () => events);
  __setSportsDataProviderForTesting({
    getFixtureResult,
    getFixtureEvents,
  } as unknown as SportsDataProvider);
  return { getFixtureEvents };
}

const finishedHt = (
  home: number,
  away: number,
  ht: { home: number; away: number },
): NormalizedFixtureResult => ({
  status: "finished",
  regulationScore: { home, away },
  halftimeScore: ht,
});

function eventsHomeFirst(): NormalizedFixtureEvents {
  return {
    fixtureStatus: "finished",
    eventsAvailable: true,
    goals: [
      {
        playerId: null,
        playerName: "Pedro",
        teamSide: "home",
        minute: 20,
        isPenalty: false,
        isOwnGoal: false,
        isRegulation: true,
      },
    ],
    assists: [],
  };
}

describe("settleUserBetLegs — kinds de mercado (Fase 2)", () => {
  it("over_under over 2.5 sobre 3-0 → won; match_result home → won", async () => {
    const matchId = await seedMatch("ext-market");
    const slipId = await seedSlip(matchId);
    const ou = await seedLeg({
      slipId,
      kind: "over_under",
      params: { selection: "over", line: 2.5 },
    });
    const mr = await seedLeg({
      slipId,
      kind: "match_result",
      params: { selection: "home" },
    });
    installProvider(() => finished(3, 0));

    const s = await settleUserBetLegs(NOW);
    expect(s.considered).toBe(2);
    expect(s.settled).toBe(2);
    const out = await outcomesByLeg();
    expect(out.get(ou)!.result).toBe("won");
    expect(out.get(mr)!.result).toBe("won");
  });

  it("first_half_over_under over 0.5 com HT 1-0 → won", async () => {
    const matchId = await seedMatch("ext-fhou");
    const slipId = await seedSlip(matchId);
    const leg = await seedLeg({
      slipId,
      kind: "first_half_over_under",
      params: { selection: "over", line: 0.5 },
    });
    installProviderFull(finishedHt(2, 0, { home: 1, away: 0 }));

    const s = await settleUserBetLegs(NOW);
    expect(s.settled).toBe(1);
    expect((await outcomesByLeg()).get(leg)!.result).toBe("won");
  });

  it("first_to_score (event-backed): busca eventos e liquida home", async () => {
    const matchId = await seedMatch("ext-fts");
    const slipId = await seedSlip(matchId);
    const leg = await seedLeg({
      slipId,
      kind: "first_to_score",
      params: { firstToScore: "home" },
    });
    const { getFixtureEvents } = installProviderFull(
      finishedHt(2, 0, { home: 1, away: 0 }),
      eventsHomeFirst(),
    );

    const s = await settleUserBetLegs(NOW);
    expect(s.settled).toBe(1);
    expect((await outcomesByLeg()).get(leg)!.result).toBe("won");
    // O fetch de eventos SÓ dispara com uma perna event-backed pendente.
    expect(getFixtureEvents).toHaveBeenCalledTimes(1);
  });

  it("first_to_score sem eventos (undefined) → PENDING (prefer-skip)", async () => {
    const matchId = await seedMatch("ext-fts-noevents");
    const slipId = await seedSlip(matchId);
    const leg = await seedLeg({
      slipId,
      kind: "first_to_score",
      params: { firstToScore: "home" },
    });
    installProviderFull(finishedHt(2, 0, { home: 1, away: 0 }), undefined);

    const s = await settleUserBetLegs(NOW);
    expect(s.settled).toBe(0);
    expect(s.errors).toBe(1);
    expect((await outcomesByLeg()).has(leg)).toBe(false);
  });
});
