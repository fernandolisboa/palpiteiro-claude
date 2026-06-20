// @vitest-environment node
//
// Liquidação de cartões web-grounded (#394) contra Postgres REAL (pglite). Mocka a
// COBERTURA (isCardsCovered → toggle) e a EXTRAÇÃO (extractCardCount → conta controlada)
// pra exercitar a ORQUESTRAÇÃO (settle-palpites.ts): gate de cobertura, finished-gate,
// attempt-cap cross-tick, double SQL-gate (#419 settleable=false), e o caminho
// won/lost/PENDENTE. A inércia com cobertura REAL (vazia) vive em
// settle-palpites-cards-inert.pglite.test.ts.
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
    },
  ),
}));

// Cobertura e extração mockadas (toggle por teste via vi.hoisted).
const h = vi.hoisted(() => ({
  covered: { value: true },
  extractSpy: vi.fn<(...a: unknown[]) => Promise<number | null>>(),
}));
vi.mock("@/lib/settlement/cards-coverage", () => ({
  isCardsCovered: () => h.covered.value,
  CARDS_COVERED_LEAGUES: new Set<string>(),
}));
vi.mock("@/lib/settlement/extract-cards-from-web", () => ({
  extractCardCount: h.extractSpy,
}));

import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settlePendingPalpites } from "@/lib/settlement/settle-palpites";

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

async function seedSet(matchId: string, userId = ids.userId): Promise<string> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId,
      userId,
      aiCallId: null,
      modelVersion: "claude-3-5-haiku-latest",
      promptVersion: "palpites_v8",
    })
    .returning({ id: schema.palpiteSets.id });
  return s.id;
}

async function seedCards(
  externalId: string,
  opts: { line?: 4 | 6; settleable?: boolean } = {},
): Promise<{ matchId: string; palpiteId: string }> {
  const matchId = await seedMatch(externalId);
  const setId = await seedSet(matchId);
  const [p] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: setId,
      type: "cards",
      text: `${opts.line ?? 4}+ cartões amarelos`,
      params: { line: opts.line ?? 4, scope: "total" },
      settleable: opts.settleable ?? true,
    })
    .returning({ id: schema.palpites.id });
  return { matchId, palpiteId: p.id };
}

function installResult(
  resultFor: (ref: FixtureRef) => NormalizedFixtureResult | undefined,
): void {
  __setSportsDataProviderForTesting({
    getFixtureResult: vi.fn(async (ref: FixtureRef) => resultFor(ref)),
    getFixtureEvents: vi.fn(async () => undefined),
  } as unknown as SportsDataProvider);
}

const finished = (home: number, away: number): NormalizedFixtureResult => ({
  status: "finished",
  regulationScore: { home, away },
});

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
    .values({ email: "cards-settle@example.com" })
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
  h.covered.value = true;
  h.extractSpy.mockReset();
  h.extractSpy.mockResolvedValue(null);
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
async function attemptsFor(palpiteId: string): Promise<number> {
  const rows = await realDb
    .select()
    .from(schema.palpiteSettlementAttempts)
    .where(eq(schema.palpiteSettlementAttempts.palpiteId, palpiteId));
  return rows[0]?.attempts ?? 0;
}

describe("settlePendingPalpites — cards (caminho coberto)", () => {
  it("conta 5 >= line 4 → won; resultData carrega yellowCardsTotal", async () => {
    const { palpiteId } = await seedCards("cards-won", { line: 4 });
    installResult(() => finished(2, 1));
    h.extractSpy.mockResolvedValue(5);

    const s = await settlePendingPalpites(NOW);
    expect(s.considered).toBe(1);
    expect(s.settled).toBe(1);
    expect(s.byResult).toEqual({ won: 1, lost: 0 });

    const out = (await outcomesByPalpite()).get(palpiteId)!;
    expect(out.result).toBe("won");
    expect(out.resultData?.yellowCardsTotal).toBe(5);
    expect(h.extractSpy).toHaveBeenCalledTimes(1);
  });

  it("conta 3 < line 4 → lost", async () => {
    const { palpiteId } = await seedCards("cards-lost", { line: 4 });
    installResult(() => finished(0, 0));
    h.extractSpy.mockResolvedValue(3);

    const s = await settlePendingPalpites(NOW);
    expect(s.byResult).toEqual({ won: 0, lost: 1 });
    expect((await outcomesByPalpite()).get(palpiteId)!.result).toBe("lost");
  });

  it("extração não reconciliou (null) → PENDENTE (sem outcome), conta como erro", async () => {
    const { palpiteId } = await seedCards("cards-pending", { line: 4 });
    installResult(() => finished(2, 1));
    h.extractSpy.mockResolvedValue(null);

    const s = await settlePendingPalpites(NOW);
    expect(s.settled).toBe(0);
    expect(s.errors).toBe(1); // regra lança (yellowCardsTotal undefined) → PENDING
    expect((await outcomesByPalpite()).has(palpiteId)).toBe(false);
    expect(h.extractSpy).toHaveBeenCalledTimes(1);
  });

  it("jogo NÃO finalizado → nenhuma extração (gate de gasto), nenhum outcome", async () => {
    const { palpiteId } = await seedCards("cards-live", { line: 4 });
    installResult(() => ({ status: "live", regulationScore: { home: 1, away: 0 } }));

    const s = await settlePendingPalpites(NOW);
    expect(s.skipped).toBe(1);
    expect(h.extractSpy).not.toHaveBeenCalled(); // finished-gate ANTES da chamada paga
    expect((await outcomesByPalpite()).has(palpiteId)).toBe(false);
    expect(await attemptsFor(palpiteId)).toBe(0); // cedo demais não consome tentativa
  });
});

describe("settlePendingPalpites — cards attempt-cap cross-tick", () => {
  it("A≠B repetido: incrementa por tick, para de extrair no CAP (=3)", async () => {
    const { palpiteId } = await seedCards("cards-cap", { line: 4 });
    installResult(() => finished(2, 1));
    h.extractSpy.mockResolvedValue(null); // sempre PENDENTE

    for (let i = 0; i < 5; i++) await settlePendingPalpites(NOW);

    expect(h.extractSpy).toHaveBeenCalledTimes(3); // 3 ticks, depois cap bloqueia
    expect(await attemptsFor(palpiteId)).toBe(3);
    expect((await outcomesByPalpite()).has(palpiteId)).toBe(false); // segue PENDENTE
  });
});

describe("settlePendingPalpites — cards double SQL-gate (#419)", () => {
  it("row de cartão #419 com settleable=false NUNCA entra no pending (nem extrai)", async () => {
    const { palpiteId } = await seedCards("cards-419-inert", {
      line: 4,
      settleable: false,
    });
    installResult(() => finished(2, 1));
    h.extractSpy.mockResolvedValue(5);

    const s = await settlePendingPalpites(NOW);
    expect(s.considered).toBe(0); // double gate: inArray(type) AND settleable=true
    expect(h.extractSpy).not.toHaveBeenCalled();
    expect((await outcomesByPalpite()).has(palpiteId)).toBe(false);
  });
});

describe("settlePendingPalpites — cards cobertura desligada", () => {
  it("isCardsCovered=false → finished mas SEM extração, SEM outcome, SEM tentativa", async () => {
    h.covered.value = false;
    const { palpiteId } = await seedCards("cards-uncovered", { line: 4 });
    installResult(() => finished(2, 1));
    h.extractSpy.mockResolvedValue(5);

    const s = await settlePendingPalpites(NOW);
    expect(s.considered).toBe(1); // está no pending (settleable=true)
    expect(h.extractSpy).not.toHaveBeenCalled(); // cobertura gateia a chamada paga
    expect((await outcomesByPalpite()).has(palpiteId)).toBe(false); // PENDENTE
    expect(await attemptsFor(palpiteId)).toBe(0);
  });
});
