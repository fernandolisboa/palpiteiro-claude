// @vitest-environment node
//
// findReusableJudgments (#511, ADR 0041 §1) contra Postgres REAL via pglite: os
// filtros em jsonb (applied/stateHash/versões) + jogo + janela de tempo, e a mais
// recente vence. Roda em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";
import type { PredictionJudgments } from "@/lib/ai/engine/types";

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

import { findReusableJudgments } from "@/lib/db/queries/judgments";

const ids: {
  userId: string;
  matchId: string;
  otherMatchId: string;
  aiCallId: string;
} = {} as never;

const NOW = new Date("2026-05-12T12:00:00Z");
const SINCE = new Date(NOW.getTime() - 6 * 3_600_000);

function judgments(
  overrides: Partial<PredictionJudgments> = {}
): PredictionJudgments {
  return {
    engine: "code_jev",
    applied: true,
    answers: {} as PredictionJudgments["answers"],
    multipliers: null,
    lambda: {
      source: "heuristic",
      degraded: false,
      rho: null,
      base: { home: 1.5, away: 1.1 },
      adjusted: { home: 1.5, away: 1.1 },
    },
    versions: {
      judgments: "jev_judgments_v1",
      weights: "judgment_weights_v1",
      narrator: "narrator_v1",
      jevModel: "jev-1.13.0",
    },
    failure: null,
    stateHash: "hash-a",
    aiCallId: null,
    reusedFromPredictionId: null,
    ...overrides,
  };
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "jev-reuse@pglite.test", role: "admin", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [m, m2] = await base
    .insert(schema.matches)
    .values([
      {
        externalId: "ext-jev-1",
        league: "brasileirao_a",
        homeTeam: "CR Flamengo",
        awayTeam: "Fluminense FC",
        kickoffAt: new Date("2026-05-15T19:00:00Z"),
      },
      {
        externalId: "ext-jev-2",
        league: "brasileirao_a",
        homeTeam: "SE Palmeiras",
        awayTeam: "SC Corinthians",
        kickoffAt: new Date("2026-05-16T19:00:00Z"),
      },
    ])
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;
  ids.otherMatchId = m2.id;
  const [ac] = await base
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId: ids.matchId,
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      promptVersion: "narrator_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      costUsd: "0.010000",
      status: "ok",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ac.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictions);
});

async function insertPrediction(values: {
  judgments: PredictionJudgments | null;
  createdAt: Date;
  matchId?: string;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: values.matchId ?? ids.matchId,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      recommendation: "pass",
      confidencePct: "50.00",
      rationale: "r",
      keyFactors: ["a"],
      modelVersion: "m",
      promptVersion: "narrator_v1",
      judgments: values.judgments,
      createdAt: values.createdAt,
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

const find = (stateHash = "hash-a") =>
  findReusableJudgments({
    matchId: ids.matchId,
    judgmentsVersion: "jev_judgments_v1",
    weightsVersion: "judgment_weights_v1",
    stateHash,
    since: SINCE,
  });

describe("findReusableJudgments", () => {
  it("devolve a mais recente do jogo com mesmo hash, versões e applied=true", async () => {
    await insertPrediction({
      judgments: judgments(),
      createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
    });
    const newest = await insertPrediction({
      judgments: judgments({ aiCallId: "call-2" }),
      createdAt: new Date(NOW.getTime() - 3_600_000),
    });
    const out = await find();
    expect(out?.predictionId).toBe(newest);
    expect(out?.judgments.aiCallId).toBe("call-2");
  });

  it("ignora state diferente, versões diferentes, applied=false, sem judgments e outro jogo", async () => {
    const at = new Date(NOW.getTime() - 3_600_000);
    await insertPrediction({
      judgments: judgments({ stateHash: "hash-b" }),
      createdAt: at,
    });
    await insertPrediction({
      judgments: judgments({
        versions: { ...judgments().versions, weights: "judgment_weights_v2" },
      }),
      createdAt: at,
    });
    await insertPrediction({
      judgments: judgments({
        versions: { ...judgments().versions, judgments: "jev_judgments_v2" },
      }),
      createdAt: at,
    });
    await insertPrediction({
      judgments: judgments({ applied: false, answers: null }),
      createdAt: at,
    });
    await insertPrediction({ judgments: null, createdAt: at });
    await insertPrediction({
      judgments: judgments(),
      createdAt: at,
      matchId: ids.otherMatchId,
    });
    expect(await find()).toBeNull();
  });

  it("ignora a que é mais velha que a janela", async () => {
    await insertPrediction({
      judgments: judgments(),
      createdAt: new Date(SINCE.getTime() - 60_000),
    });
    expect(await find()).toBeNull();
  });
});
