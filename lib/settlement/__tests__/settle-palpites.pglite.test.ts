// @vitest-environment node
//
// Settlement de palpites de placar exato contra Postgres REAL via pglite (WASM).
// Roda as migrations reais 1x, semeia o grafo mínimo (user + match + palpite_set +
// palpite), injeta um provider mockado pros scores e roda settlePendingPalpites com
// as QUERIES REAIS. Cobre: hit/miss, 4-1 liquida (SEM grade 0-3), 4-2 lost, ET/
// null-regulationScore → skipped (compare usa SÓ 90'), settleable=false NUNCA
// liquida, e idempotência (2ª run = no-op). Roda em `node` (pglite falha sob jsdom).
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
    }
  ),
}));

import {
  __setSportsDataProviderForTesting,
  getSportsDataProvider,
} from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settlePendingPalpites } from "@/lib/settlement/settle-palpites";

const ids: { userId: string } = {} as never;

// kickoff bem no passado pra cair sempre dentro do cutoff (kickoff < now - 150min).
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

async function seedSet(matchId: string): Promise<string> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId,
      userId: ids.userId,
      aiCallId: null,
      modelVersion: "claude-3-5-haiku-latest",
      promptVersion: "exact_score_palpite_v1",
    })
    .returning({ id: schema.palpiteSets.id });
  return s.id;
}

async function seedPalpite(args: {
  palpiteSetId: string;
  type?: "exact_score" | "red_card" | "corners";
  params?: { home: number; away: number } | null;
  settleable?: boolean;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: args.palpiteSetId,
      type: args.type ?? "exact_score",
      text: "stub",
      params: args.params ?? null,
      settleable: args.settleable ?? false,
    })
    .returning({ id: schema.palpites.id });
  return p.id;
}

// Semeia um palpite exact_score settleable num jogo finished + retorna seu id.
async function seedExactScore(
  externalId: string,
  params: { home: number; away: number }
): Promise<string> {
  const matchId = await seedMatch(externalId);
  const setId = await seedSet(matchId);
  return seedPalpite({
    palpiteSetId: setId,
    type: "exact_score",
    params,
    settleable: true,
  });
}

function installProvider(
  resultFor: (ref: FixtureRef) => NormalizedFixtureResult | undefined
): void {
  const getFixtureResult = vi.fn(async (ref: FixtureRef) => resultFor(ref));
  __setSportsDataProviderForTesting({
    getFixtureResult,
  } as unknown as SportsDataProvider);
}

const finished = (home: number, away: number): NormalizedFixtureResult => ({
  status: "finished",
  regulationScore: { home, away },
});

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // Shim de batch por simetria com a harness existente (settle não chama .batch).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (base as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "palpite-settle@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
  await realDb.delete(schema.matches);
});

afterEach(() => {
  __setSportsDataProviderForTesting(undefined);
  vi.restoreAllMocks();
});

type OutcomeRow = typeof schema.palpiteOutcomes.$inferSelect;

async function outcomesByPalpite(): Promise<Map<string, OutcomeRow>> {
  const rows = await realDb.select().from(schema.palpiteOutcomes);
  return new Map(rows.map((r) => [r.palpiteId, r]));
}

describe("settlePendingPalpites — placar exato", () => {
  it("hit: palpite 2-1 sobre 2-1 → outcome won", async () => {
    const id = await seedExactScore("ext-hit", { home: 2, away: 1 });
    installProvider(() => finished(2, 1));

    const s = await settlePendingPalpites(NOW);
    expect(s.considered).toBe(1);
    expect(s.settled).toBe(1);
    expect(s.byResult).toEqual({ won: 1, lost: 0 });

    const out = (await outcomesByPalpite()).get(id)!;
    expect(out.result).toBe("won");
    expect(out.resultData).toEqual({
      homeScore: 2,
      awayScore: 1,
      totalGoals: 3,
    });
  });

  it("miss: palpite 2-1 sobre 0-0 → outcome lost", async () => {
    const id = await seedExactScore("ext-miss", { home: 2, away: 1 });
    installProvider(() => finished(0, 0));

    const s = await settlePendingPalpites(NOW);
    expect(s.settled).toBe(1);
    expect(s.byResult).toEqual({ won: 0, lost: 1 });

    const out = (await outcomesByPalpite()).get(id)!;
    expect(out.result).toBe("lost");
    expect(out.resultData).toEqual({
      homeScore: 0,
      awayScore: 0,
      totalGoals: 0,
    });
  });

  it("4-1 liquida won (SEM grade 0-3 — o caso que correctScoreRule trataria como lost)", async () => {
    const id = await seedExactScore("ext-4-1", { home: 4, away: 1 });
    installProvider(() => finished(4, 1));

    const s = await settlePendingPalpites(NOW);
    expect(s.settled).toBe(1);
    expect(s.byResult).toEqual({ won: 1, lost: 0 });
    expect((await outcomesByPalpite()).get(id)!.result).toBe("won");
  });

  it("4-1 sobre 4-2 → lost (placar fora da grade que não bate AINDA liquida, não fica pending)", async () => {
    const id = await seedExactScore("ext-4-2", { home: 4, away: 1 });
    installProvider(() => finished(4, 2));

    const s = await settlePendingPalpites(NOW);
    expect(s.settled).toBe(1);
    expect(s.skipped).toBe(0);
    expect(s.byResult).toEqual({ won: 0, lost: 1 });
    expect((await outcomesByPalpite()).get(id)!.result).toBe("lost");
  });
});

describe("settlePendingPalpites — prefer skip over silent wrong settle", () => {
  it("ET/prorrogação: regulationScore null → skipped, NENHUM outcome (nunca liquida pelo placar de ET)", async () => {
    const id = await seedExactScore("ext-et", { home: 2, away: 1 });
    // Jogo decidido na prorrogação: finished mas SEM regulationScore (split de 90'
    // indisponível). O compare usa SÓ regulationScore → fica pending.
    installProvider(() => ({ status: "finished", regulationScore: null }));

    const s = await settlePendingPalpites(NOW);
    expect(s.considered).toBe(1);
    expect(s.settled).toBe(0);
    expect(s.skipped).toBe(1);
    expect((await outcomesByPalpite()).has(id)).toBe(false);
  });

  it("jogo não-finalizado → skipped, nenhum outcome", async () => {
    const id = await seedExactScore("ext-live", { home: 1, away: 1 });
    installProvider(() => ({
      status: "live",
      regulationScore: { home: 1, away: 1 },
    }));

    const s = await settlePendingPalpites(NOW);
    expect(s.settled).toBe(0);
    expect(s.skipped).toBe(1);
    expect((await outcomesByPalpite()).has(id)).toBe(false);
  });

  it("settleable=false (red_card) NUNCA liquida: fora do pending set, zero outcome", async () => {
    const matchId = await seedMatch("ext-non-settleable");
    const setId = await seedSet(matchId);
    const redId = await seedPalpite({
      palpiteSetId: setId,
      type: "red_card",
      params: null,
      settleable: false,
    });
    installProvider(() => finished(2, 1));

    const s = await settlePendingPalpites(NOW);
    // O filtro type='exact_score' AND settleable=true exclui a linha → considered 0.
    expect(s.considered).toBe(0);
    expect(s.settled).toBe(0);
    expect((await outcomesByPalpite()).has(redId)).toBe(false);
  });

  it("settleable=false NEM com type='exact_score' liquida (gate duplo)", async () => {
    const matchId = await seedMatch("ext-exact-not-settleable");
    const setId = await seedSet(matchId);
    const id = await seedPalpite({
      palpiteSetId: setId,
      type: "exact_score",
      params: { home: 2, away: 1 },
      settleable: false,
    });
    installProvider(() => finished(2, 1));

    const s = await settlePendingPalpites(NOW);
    expect(s.considered).toBe(0);
    expect((await outcomesByPalpite()).has(id)).toBe(false);
  });
});

describe("settlePendingPalpites — idempotência", () => {
  it("2ª run no mesmo jogo → settled=0, alreadySettled=1, row inalterada", async () => {
    const id = await seedExactScore("ext-idem", { home: 2, away: 1 });
    installProvider(() => finished(2, 1));

    const first = await settlePendingPalpites(NOW);
    expect(first.settled).toBe(1);
    const before = (await outcomesByPalpite()).get(id)!;

    const second = await settlePendingPalpites(NOW);
    // A row já liquidada não reaparece no pending set (isNull outcome) →
    // considered 0, nada re-tocado.
    expect(second.considered).toBe(0);
    expect(second.settled).toBe(0);
    expect(second.alreadySettled).toBe(0);
    const after = (await outcomesByPalpite()).get(id)!;
    expect(after).toEqual(before); // byte-idêntico (incl. settledAt)
  });
});

// Sanity: o seam de teste do provider está ligado igual ao factory real.
describe("provider test seam (pglite)", () => {
  it("getSportsDataProvider returns the injected provider", () => {
    const provider = {
      getFixtureResult: vi.fn(),
    } as unknown as SportsDataProvider;
    __setSportsDataProviderForTesting(provider);
    expect(getSportsDataProvider()).toBe(provider);
    __setSportsDataProviderForTesting(undefined);
  });
});
