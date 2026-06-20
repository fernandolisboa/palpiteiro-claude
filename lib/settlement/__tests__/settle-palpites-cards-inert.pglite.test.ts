// @vitest-environment node
//
// INÉRCIA POR CONSTRUÇÃO (#394): com a COBERTURA REAL (CARDS_COVERED_LEAGUES vazio, NÃO
// mockada), uma row de cartão settleable=true num jogo finalizado NUNCA dispara a
// extração paga. Prova que o gate de cobertura barra o fan-out ANTES da chamada paga —
// zero gasto, zero badge — sem flag manual. Só a EXTRAÇÃO é espionada (pra afirmar que
// nunca é chamada); cards-coverage roda de verdade.
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

// SÓ a extração é espionada — cards-coverage roda REAL (set vazio).
const h = vi.hoisted(() => ({
  extractSpy: vi.fn<(...a: unknown[]) => Promise<number | null>>(),
}));
vi.mock("@/lib/settlement/extract-cards-from-web", () => ({
  extractCardCount: h.extractSpy,
}));

import {
  __setSportsDataProviderForTesting,
  getSportsDataProvider,
} from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settlePendingPalpites } from "@/lib/settlement/settle-palpites";

const ids: { userId: string } = {} as never;
const KICKOFF = new Date("2026-05-15T19:00:00Z");
const NOW = new Date("2026-05-16T00:00:00Z");

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
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
    .values({ email: "cards-inert@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteSettlementAttempts);
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
  await realDb.delete(schema.matches);
  h.extractSpy.mockClear();
});

afterEach(() => {
  __setSportsDataProviderForTesting(undefined);
  vi.restoreAllMocks();
});

describe("settlePendingPalpites — cards inerte por cobertura real (vazia)", () => {
  it("cards settleable=true + jogo finalizado, mas liga não-coberta → ZERO extração, ZERO outcome", async () => {
    const [m] = await realDb
      .insert(schema.matches)
      .values({
        externalId: "cards-real-inert",
        league: "brasileirao_a",
        homeTeam: "CR Flamengo",
        awayTeam: "Fluminense FC",
        kickoffAt: KICKOFF,
      })
      .returning({ id: schema.matches.id });
    const [s] = await realDb
      .insert(schema.palpiteSets)
      .values({
        matchId: m.id,
        userId: ids.userId,
        aiCallId: null,
        modelVersion: "claude-3-5-haiku-latest",
        promptVersion: "palpites_v8",
      })
      .returning({ id: schema.palpiteSets.id });
    const [p] = await realDb
      .insert(schema.palpites)
      .values({
        palpiteSetId: s.id,
        type: "cards",
        text: "4+ cartões amarelos",
        params: { line: 4, scope: "total" },
        settleable: true, // row NOVA: settleable=true persistido (forcing function)
      })
      .returning({ id: schema.palpites.id, settleable: schema.palpites.settleable });
    expect(p.settleable).toBe(true);

    __setSportsDataProviderForTesting({
      getFixtureResult: vi.fn(async (_ref: FixtureRef) => ({
        status: "finished",
        regulationScore: { home: 2, away: 1 },
      })) as unknown,
      getFixtureEvents: vi.fn(async () => undefined),
    } as unknown as SportsDataProvider);

    const summary = await settlePendingPalpites(NOW);

    // A row ESTÁ no pending (settleable=true), mas a cobertura vazia barra a extração.
    expect(summary.considered).toBe(1);
    expect(h.extractSpy).not.toHaveBeenCalled();
    const outcomes = await realDb.select().from(schema.palpiteOutcomes);
    expect(outcomes).toHaveLength(0);
    const attempts = await realDb
      .select()
      .from(schema.palpiteSettlementAttempts);
    expect(attempts).toHaveLength(0); // nem tentativa registrada
  });
});

// Sanity: o seam de teste do provider está injetado.
describe("provider seam (pglite, inert)", () => {
  it("getSportsDataProvider devolve o provider injetado", () => {
    const provider = {
      getFixtureResult: vi.fn(),
    } as unknown as SportsDataProvider;
    __setSportsDataProviderForTesting(provider);
    expect(getSportsDataProvider()).toBe(provider);
    __setSportsDataProviderForTesting(undefined);
  });
});
