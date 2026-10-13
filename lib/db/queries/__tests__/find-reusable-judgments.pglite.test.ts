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
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";

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
  await realDb.delete(schema.matchModelSnapshots);
});

// Base do modelo do jogo (#555) com JEV aplicado e o checked_at pedido.
async function insertSnapshot(checkedAt: Date, stateHash = "hash-a") {
  const [s] = await realDb
    .insert(schema.matchModelSnapshots)
    .values({
      matchId: ids.matchId,
      computedAt: checkedAt,
      checkedAt,
      modelVersion: "match_model_v1",
      fingerprint: "fp",
      lambdaSource: "heuristic",
      lambdaDegraded: false,
      lambdaFallbackReason: "no_fit",
      rho: null,
      neutral: false,
      lambdaHomeBase: 1.5,
      lambdaAwayBase: 1.1,
      lambdaHome: 1.5,
      lambdaAway: 1.1,
      jevStatus: "applied",
      judgments: {
        applied: true,
        answers: Object.fromEntries(
          JUDGMENT_QUESTION_IDS.map((id) => [id, { value: 0.2, confidence: null }]),
        ) as JudgmentAnswers,
        multipliers: null,
        versions: {
          judgments: "jev_judgments_v1",
          weights: "judgment_weights_v1",
          jevModel: "jev-1.13.0",
          jevModelServed: "jev-1.13.0",
        },
        failure: null,
        stateHash,
        aiCallId: "call-cron",
        reusedFromPredictionId: null,
        reusedFromModelSnapshotId: null,
      },
      probabilities: {
        match_result: { home: 45, draw: 27, away: 28 },
        double_chance: { home_or_draw: 72, away_or_draw: 55, home_or_away: 73 },
        btts: { yes: 50, no: 50 },
        over_under: {
          "1.5": { over: 75, under: 25 },
          "2.5": { over: 48, under: 52 },
          "3.5": { over: 25, under: 75 },
        },
      },
      topScorelines: [{ home: 1, away: 1, pct: 12 }],
    })
    .returning({ id: schema.matchModelSnapshots.id });
  return s.id;
}

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
    jevModel: "jev-1.13.0",
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

  it("ignora state diferente, versões diferentes, outro modelo JEV, applied=false, sem judgments e outro jogo", async () => {
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
      judgments: judgments({
        versions: { ...judgments().versions, jevModel: "jev-1.14.0" },
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

  describe("contexto extra (#565)", () => {
    const userContext = {
      claims: [],
      evidence: { attack_weakened_home: 0.7 },
      extractionAiCallId: null,
      warnings: [],
      versions: { userEvidence: "user_evidence_v1", extract: "user_palpite_extract_v1" },
    };

    it("row com contexto e JEV aplicado é reusada; answers é só o JEV", async () => {
      const jevOnly = { attack_weakened_home: { value: 0.2, confidence: null } };
      const id = await insertPrediction({
        judgments: judgments({
          answers: jevOnly as unknown as PredictionJudgments["answers"],
          userContext,
        }),
        createdAt: new Date(NOW.getTime() - 3_600_000),
      });
      const out = await find();
      expect(out?.predictionId).toBe(id);
      expect(out?.judgments.answers).toEqual(jevOnly);
    });

    it("JEV que falhou + contexto (applied=false) é ignorada; a válida mais antiga segue achada", async () => {
      const older = await insertPrediction({
        judgments: judgments(),
        createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
      });
      await insertPrediction({
        judgments: judgments({ applied: false, answers: null, userContext }),
        createdAt: new Date(NOW.getTime() - 3_600_000),
      });
      expect((await find())?.predictionId).toBe(older);
    });
  });

  it("ignora a que é mais velha que a janela", async () => {
    await insertPrediction({
      judgments: judgments(),
      createdAt: new Date(SINCE.getTime() - 60_000),
    });
    expect(await find()).toBeNull();
  });
});

describe("findReusableJudgments — origem base do modelo (#555)", () => {
  it("sem predição → acha a base (predictionId null, modelSnapshotId)", async () => {
    const snapId = await insertSnapshot(new Date(NOW.getTime() - 3_600_000));
    const out = await find();
    expect(out?.predictionId).toBeNull();
    expect(out?.modelSnapshotId).toBe(snapId);
    expect(out?.judgments.aiCallId).toBe("call-cron");
  });

  it("com as duas → a predição vence", async () => {
    await insertSnapshot(new Date(NOW.getTime() - 3_600_000));
    const predId = await insertPrediction({
      judgments: judgments(),
      createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
    });
    const out = await find();
    expect(out?.predictionId).toBe(predId);
    expect(out?.modelSnapshotId).toBeUndefined();
  });

  it("snapshotSince: base de 10h vale com janela de 12h, não com a de 6h", async () => {
    await insertSnapshot(new Date(NOW.getTime() - 10 * 3_600_000));
    expect(await find()).toBeNull();
    const out = await findReusableJudgments({
      matchId: ids.matchId,
      judgmentsVersion: "jev_judgments_v1",
      weightsVersion: "judgment_weights_v1",
      jevModel: "jev-1.13.0",
      stateHash: "hash-a",
      since: SINCE,
      snapshotSince: new Date(NOW.getTime() - 12 * 3_600_000),
    });
    expect(out?.modelSnapshotId).toBeTruthy();
  });
});
