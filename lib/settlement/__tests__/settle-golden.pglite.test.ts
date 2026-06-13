// @vitest-environment node
//
// Golden de paridade do settlement contra Postgres REAL via pglite (WASM). Roda
// as migrations reais 1x, semeia o grafo mínimo (user + aiCall + matches +
// predictions), injeta um provider mockado pros scores e roda
// settlePendingPredictions com as QUERIES REAIS (exercita os LEFT JOINs novos do
// #166). Os esperados são LITERAIS calculados à mão pela fórmula binária antiga —
// o oráculo de "re-settlar histórico over/under = byte-idêntico". Roda em `node`
// (pglite falha sob jsdom: r.arrayBuffer is not a function).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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

// `@/lib/db` mockado pra apontar pro pglite. `realDb` é preenchido no beforeAll
// (depois das migrations). O Proxy delega tudo, incluindo `.batch` (shim abaixo).
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
  getSportsDataProvider,
} from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settlePendingPredictions } from "@/lib/settlement/settle";

const ids: {
  userId: string;
  ouMarketId: string;
  ouOver: string;
  ouUnder: string;
} = {} as never;

// kickoff bem no passado pra cair sempre dentro do cutoff (kickoff < now - 150min).
const KICKOFF = new Date("2026-05-15T19:00:00Z");

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

async function seedAiCall(matchId: string): Promise<string> {
  const [c] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId,
      model: "stub-model",
      promptVersion: "over_under_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costUsd: "0",
    })
    .returning({ id: schema.aiCalls.id });
  return c.id;
}

type PredArgs = {
  matchId: string;
  aiCallId: string;
  recommendation: "over" | "under" | "pass";
  selectionId: string | null;
  marketParams: { line: number } | null;
  oddAtRecommendation: string | null;
  stakeUnits?: string;
};

async function seedPrediction(args: PredArgs): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: args.matchId,
      userId: ids.userId,
      aiCallId: args.aiCallId,
      marketId: ids.ouMarketId,
      selectionId: args.selectionId,
      marketParams: args.marketParams,
      recommendation: args.recommendation,
      confidencePct: "60",
      rationale: "stub",
      keyFactors: ["stub"],
      oddAtRecommendation: args.oddAtRecommendation,
      stakeUnits: args.stakeUnits ?? "1",
      modelVersion: "stub",
      promptVersion: "over_under_v1",
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

function installProvider(
  resultFor: (ref: FixtureRef) => NormalizedFixtureResult | undefined,
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
  // Shim de batch por simetria com a harness existente (este arquivo usa os
  // builders direto via as queries reais — settle não chama .batch).
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
    .values({ email: "golden@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  // over_under já é seedado pela migration 0009.
  const [ou] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "over_under"));
  ids.ouMarketId = ou.id;
  const ouSels = await base
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ou.id));
  ids.ouOver = ouSels.find((s) => s.key === "over")!.id;
  ids.ouUnder = ouSels.find((s) => s.key === "under")!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictionOutcomes);
  await realDb.delete(schema.predictions);
  await realDb.delete(schema.aiCalls);
  await realDb.delete(schema.matches);
});

afterEach(() => {
  __setSportsDataProviderForTesting(undefined);
  vi.restoreAllMocks();
});

type OutcomeRow = typeof schema.predictionOutcomes.$inferSelect;

async function outcomesByPrediction(): Promise<Map<string, OutcomeRow>> {
  const rows = await realDb.select().from(schema.predictionOutcomes);
  return new Map(rows.map((r) => [r.predictionId, r]));
}

describe("settle golden — real Postgres (pglite)", () => {
  it("settles an over/under grid byte-identical to the longhand old formula", async () => {
    const matchId = await seedMatch("ext-golden-1");
    const aiCallId = await seedAiCall(matchId);

    // 3 gols (provider 2-1): over ganha, under perde, pass vira void.
    const overId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "over",
      selectionId: ids.ouOver,
      marketParams: { line: 2.5 },
      oddAtRecommendation: "1.900",
      stakeUnits: "1",
    });
    const underId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "under",
      selectionId: ids.ouUnder,
      marketParams: { line: 2.5 },
      oddAtRecommendation: "2.050",
      stakeUnits: "2",
    });
    const passId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "pass",
      selectionId: null,
      marketParams: { line: 2.5 },
      oddAtRecommendation: null,
    });
    // non-pass sem entry odd → skip (fica pendente, sem outcome row).
    const noOddId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "over",
      selectionId: ids.ouOver,
      marketParams: { line: 2.5 },
      oddAtRecommendation: null,
    });

    installProvider(() => finished(2, 1)); // 3 gols
    const s = await settlePendingPredictions(new Date("2026-05-16T00:00:00Z"));

    expect(s.settled).toBe(3); // over, under, pass
    expect(s.skipped).toBe(1); // noOdd
    expect(s.byResult).toEqual({ won: 1, lost: 1, void: 1, push: 0 });

    const byPred = await outcomesByPrediction();

    // over: stake 1, odd 1.9 → +0.90; resultData split confiável.
    const over = byPred.get(overId)!;
    expect(over.result).toBe("won");
    expect(over.profitUnits).toBe("0.90"); // numeric → string .toFixed(2)
    expect(over.totalGoals).toBe(3);
    expect(over.resultData).toEqual({
      homeScore: 2,
      awayScore: 1,
      totalGoals: 3,
    });

    // under: stake 2 → perde 2 unidades.
    const under = byPred.get(underId)!;
    expect(under.result).toBe("lost");
    expect(under.profitUnits).toBe("-2.00");
    expect(under.resultData).toEqual({
      homeScore: 2,
      awayScore: 1,
      totalGoals: 3,
    });

    // pass: void, profit 0, resultData ainda gravado.
    const pass = byPred.get(passId)!;
    expect(pass.result).toBe("void");
    expect(pass.profitUnits).toBe("0.00");
    expect(pass.resultData).toEqual({
      homeScore: 2,
      awayScore: 1,
      totalGoals: 3,
    });

    // noOdd: nenhuma outcome row (ficou pendente).
    expect(byPred.has(noOddId)).toBe(false);
  });

  it("settles a whole-line 2.0 push (finished 1-1) as push/0", async () => {
    const matchId = await seedMatch("ext-golden-push");
    const aiCallId = await seedAiCall(matchId);
    const pushId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "over",
      selectionId: ids.ouOver,
      marketParams: { line: 2.0 },
      oddAtRecommendation: "1.900",
    });

    installProvider(() => finished(1, 1)); // 2 gols == linha 2.0 → push
    const s = await settlePendingPredictions(new Date("2026-05-16T00:00:00Z"));

    expect(s.byResult.push).toBe(1);
    const byPred = await outcomesByPrediction();
    const push = byPred.get(pushId)!;
    expect(push.result).toBe("push");
    expect(push.profitUnits).toBe("0.00");
    expect(push.resultData).toEqual({
      homeScore: 1,
      awayScore: 1,
      totalGoals: 2,
    });
  });

  it("is idempotent: a second run leaves every row byte-unchanged", async () => {
    const matchId = await seedMatch("ext-golden-idem");
    const aiCallId = await seedAiCall(matchId);
    const overId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "over",
      selectionId: ids.ouOver,
      marketParams: { line: 2.5 },
      oddAtRecommendation: "1.900",
    });

    installProvider(() => finished(2, 1));
    const first = await settlePendingPredictions(
      new Date("2026-05-16T00:00:00Z"),
    );
    expect(first.settled).toBe(1);
    const before = (await outcomesByPrediction()).get(overId)!;

    const second = await settlePendingPredictions(
      new Date("2026-05-16T00:00:00Z"),
    );
    // segunda passada: a row já liquidada não reaparece no pending set (isNull
    // outcome) → considered 0, nada re-tocado.
    expect(second.considered).toBe(0);
    expect(second.settled).toBe(0);
    const after = (await outcomesByPrediction()).get(overId)!;
    expect(after).toEqual(before); // byte-idêntico (incl. settledAt)
  });

  it("never recomputes a pre-seeded outcome (re-settle historical path)", async () => {
    const matchId = await seedMatch("ext-golden-preseed");
    const aiCallId = await seedAiCall(matchId);
    const overId = await seedPrediction({
      matchId,
      aiCallId,
      recommendation: "over",
      selectionId: ids.ouOver,
      marketParams: { line: 2.5 },
      oddAtRecommendation: "1.900",
    });

    // Pré-semeia um outcome com um valor KNOWN-OLD divergente do que o settler
    // calcularia (over @ 3 gols daria won/+0.90; aqui gravamos lost/-1.00).
    await realDb.insert(schema.predictionOutcomes).values({
      predictionId: overId,
      totalGoals: 3,
      resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
      result: "lost",
      profitUnits: "-1.00",
    });
    const before = (await outcomesByPrediction()).get(overId)!;

    installProvider(() => finished(2, 1));
    const s = await settlePendingPredictions(new Date("2026-05-16T00:00:00Z"));
    expect(s.considered).toBe(0); // já tem outcome → fora do pending set
    const after = (await outcomesByPrediction()).get(overId)!;
    expect(after).toEqual(before); // intocado: override/cron never recompute
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
