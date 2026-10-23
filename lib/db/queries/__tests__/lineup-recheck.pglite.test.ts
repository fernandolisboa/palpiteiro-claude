// @vitest-environment node
//
// Reconferência com a escalação (#619, PR B), contra Postgres REAL (pglite): quem é
// reconferido (DISTINCT ON por jogo/usuário/mercado ANTES da elegibilidade), a guarda de
// corrida antes do insert, as odds congeladas do pai, e o lugar da reconferência nas
// métricas: fora do Yield/CLV/Kelly e da captura da closing line, dentro da calibração.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import type { PredictionJudgments, PredictionRecheck } from "@/lib/ai/engine/types";

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

import { getMarketCalibrationRows } from "@/lib/db/queries/calibration";
import {
  getAllDashboardRows,
  getUserDashboardRows,
} from "@/lib/db/queries/dashboard";
import {
  getFrozenSelectionOdds,
  getLineupRecheckCandidates,
  hasNewerPreMatchPrediction,
  isLineupRecheckEligible,
} from "@/lib/db/queries/lineup-recheck";
import { getNonPassPredictionsNearKickoff } from "@/lib/db/queries/predictions";
import { buildLiveStamp, liveColumns } from "@/lib/live/stamp";

const NOW = new Date("2026-05-15T18:00:00Z");
const min = (n: number) => n * 60_000;

const ids = {} as {
  userA: string;
  userB: string;
  aiCallId: string;
  ouMarketId: string;
  mrMarketId: string;
  over: string;
  under: string;
};

function judgments(
  over: Partial<PredictionJudgments> = {}
): PredictionJudgments {
  return {
    engine: "code_jev",
    applied: true,
    answers: null,
    multipliers: null,
    lambda: {
      source: "dixon_coles",
      degraded: false,
      rho: -0.05,
      base: { home: 1.4, away: 1.1 },
      adjusted: { home: 1.4, away: 1.1 },
    },
    versions: {
      judgments: "jev_judgments_v3",
      weights: "judgment_weights_v1",
      narrator: "narrator_v1.4",
      jevModel: "jev-1.13.0",
    },
    failure: null,
    stateHash: "h",
    aiCallId: null,
    reusedFromPredictionId: null,
    lineup: { status: "not_announced", home: null, away: null },
    ...over,
  };
}

function recheckOf(of: string): PredictionRecheck {
  return {
    kind: "lineup",
    version: "lineup_v1",
    of,
    parentStateHash: "h",
    oddsFrom: "snapshot",
    oddsCapturedAt: NOW.toISOString(),
    before: { recommendation: "over", line: 2.5, confidencePct: 58, edgePct: 6 },
  };
}

let seq = 0;
async function insertMatch(over: {
  kickoffAt: Date;
  status?: "scheduled" | "finished" | "live";
}): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-recheck-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: over.kickoffAt,
      status: over.status ?? "scheduled",
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

async function insertPrediction(args: {
  matchId: string;
  userId?: string;
  marketId?: string;
  recommendation?: "over" | "pass";
  createdAt: Date;
  judgments?: PredictionJudgments | null;
  live?: boolean;
  odds?: { over: string; under: string };
  modelVersion?: string;
}): Promise<string> {
  const rec = args.recommendation ?? "over";
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: args.matchId,
      userId: args.userId ?? ids.userA,
      aiCallId: ids.aiCallId,
      marketId: args.marketId ?? ids.ouMarketId,
      selectionId: rec === "pass" ? null : ids.over,
      recommendation: rec,
      confidencePct: "58.00",
      rationale: "r",
      keyFactors: ["f"],
      oddAtRecommendation: rec === "pass" ? null : "1.950",
      impliedProbPct: rec === "pass" ? null : "50.00",
      edgePct: rec === "pass" ? null : "8.00",
      stakeUnits: "2.00",
      modelVersion: args.modelVersion ?? "claude-x;engine=code_jev;lambda=dixon_coles",
      promptVersion: "narrator_v1.4",
      marketParams: { line: 2.5 },
      createdAt: args.createdAt,
      ...(args.judgments === null
        ? {}
        : { judgments: args.judgments ?? judgments() }),
      ...liveColumns(
        args.live
          ? buildLiveStamp({
              source: "api_football",
              status: "1H",
              elapsed: 10,
              extra: null,
              minuteLabel: "10'",
              score: { home: 0, away: 0 },
              red: null,
              fetchedAt: args.createdAt,
              recordedAt: args.createdAt,
            })
          : null
      ),
    })
    .returning({ id: schema.predictions.id });
  if (args.odds) {
    await realDb.insert(schema.predictionSelectionOdds).values([
      { predictionId: p.id, selectionId: ids.under, odd: args.odds.under, modelProbPct: "42.00" },
      { predictionId: p.id, selectionId: ids.over, odd: args.odds.over, modelProbPct: "58.00" },
    ]);
  }
  return p.id;
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const mkts = await realDb
    .select({ id: schema.markets.id, key: schema.markets.key })
    .from(schema.markets);
  ids.ouMarketId = mkts.find((m) => m.key === "over_under")!.id;
  ids.mrMarketId = mkts.find((m) => m.key === "match_result")!.id;
  const sels = await realDb
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ids.ouMarketId));
  ids.over = sels.find((s) => s.key === "over")!.id;
  ids.under = sels.find((s) => s.key === "under")!.id;

  const users = await realDb
    .insert(schema.users)
    .values([{ email: "recheck-a@example.com" }, { email: "recheck-b@example.com" }])
    .returning({ id: schema.users.id });
  ids.userA = users[0].id;
  ids.userB = users[1].id;
  const aiMatch = await insertMatch({ kickoffAt: new Date("2026-01-01T00:00:00Z") });
  const [ai] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: ids.userA,
      matchId: aiMatch,
      model: "m",
      promptVersion: "narrator_v1.4",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0.000001",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ai.id;
}, 60_000);

beforeEach(async () => {
  await realDb.delete(schema.predictionOutcomes);
  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
});

afterAll(async () => {
  await client.close();
});

describe("isLineupRecheckEligible (pura)", () => {
  it("só code_jev pré-jogo, antes da escalação, sem reconferência nem contexto do usuário", () => {
    expect(isLineupRecheckEligible({ judgments: judgments(), isLive: false })).toBe(true);
    // Row v2 (sem `lineup`) também é anterior à escalação.
    const v2 = judgments();
    delete v2.lineup;
    expect(isLineupRecheckEligible({ judgments: v2, isLive: false })).toBe(true);
    expect(isLineupRecheckEligible({ judgments: null, isLive: false })).toBe(false);
    expect(isLineupRecheckEligible({ judgments: judgments(), isLive: true })).toBe(false);
    expect(
      isLineupRecheckEligible({
        judgments: judgments({ recheck: recheckOf("x") }),
        isLive: false,
      })
    ).toBe(false);
    expect(
      isLineupRecheckEligible({
        judgments: judgments({
          lineup: {
            status: "announced",
            home: { changes: "0-2", leftOut: 0 },
            away: null,
          },
        }),
        isLive: false,
      })
    ).toBe(false);
    expect(
      isLineupRecheckEligible({
        judgments: judgments({
          userContext: {} as NonNullable<PredictionJudgments["userContext"]>,
        }),
        isLive: false,
      })
    ).toBe(false);
  });
});

describe("getLineupRecheckCandidates", () => {
  it("janela (agora+5, agora+75], só agendado, ordem de KO", async () => {
    const tooSoon = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(5)) });
    const late = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(70)) });
    const early = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(30)) });
    const tooFar = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(76)) });
    const notScheduled = await insertMatch({
      kickoffAt: new Date(NOW.getTime() + min(30)),
      status: "live",
    });
    for (const matchId of [tooSoon, late, early, tooFar, notScheduled]) {
      await insertPrediction({ matchId, createdAt: new Date(NOW.getTime() - min(600)) });
    }
    const got = await getLineupRecheckCandidates({ now: NOW });
    expect(got.map((c) => c.match.id)).toEqual([early, late]);
    expect(got[0].marketKey).toBe("over_under");
  });

  it("pai + reconferência dele → 0 candidatos (DISTINCT ON antes da elegibilidade)", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    const parent = await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(600)),
    });
    expect((await getLineupRecheckCandidates({ now: NOW })).map((c) => c.prediction.id)).toEqual([
      parent,
    ]);
    await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(10)),
      judgments: judgments({ recheck: recheckOf(parent) }),
    });
    expect(await getLineupRecheckCandidates({ now: NOW })).toEqual([]);
  });

  it("análise mais nova inelegível esconde o pai antigo (LLM ou depois da escalação)", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    await insertPrediction({ matchId, createdAt: new Date(NOW.getTime() - min(600)) });
    await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(30)),
      judgments: null,
    });
    expect(await getLineupRecheckCandidates({ now: NOW })).toEqual([]);
  });

  it("leitura ao vivo nunca vence o dedup nem é candidata", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    const parent = await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(600)),
    });
    await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(5)),
      recommendation: "pass",
      live: true,
    });
    const got = await getLineupRecheckCandidates({ now: NOW });
    expect(got.map((c) => c.prediction.id)).toEqual([parent]);
  });

  it("um balde por (jogo, usuário, mercado): mesma análise de dois usuários e dois mercados", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    const created = new Date(NOW.getTime() - min(600));
    const a1 = await insertPrediction({ matchId, createdAt: created });
    const a2 = await insertPrediction({
      matchId,
      createdAt: new Date(created.getTime() + 1000),
    });
    const b = await insertPrediction({ matchId, userId: ids.userB, createdAt: created });
    const mr = await insertPrediction({
      matchId,
      marketId: ids.mrMarketId,
      createdAt: created,
    });
    const got = (await getLineupRecheckCandidates({ now: NOW })).map((c) => c.prediction.id);
    expect(got).toHaveLength(3);
    expect(got).toEqual(expect.arrayContaining([a2, b, mr]));
    expect(got).not.toContain(a1);
  });
});

describe("hasNewerPreMatchPrediction (guarda antes do insert)", () => {
  it("só conta pré-jogo mais nova no mesmo balde", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    const createdAt = new Date(NOW.getTime() - min(600));
    const parentId = await insertPrediction({ matchId, createdAt });
    const parent = {
      id: parentId,
      matchId,
      userId: ids.userA,
      marketId: ids.ouMarketId,
      createdAt,
    };
    expect(await hasNewerPreMatchPrediction(parent)).toBe(false);
    // Outro usuário, outro mercado e ao vivo não contam.
    await insertPrediction({ matchId, userId: ids.userB, createdAt: NOW });
    await insertPrediction({ matchId, marketId: ids.mrMarketId, createdAt: NOW });
    await insertPrediction({ matchId, createdAt: NOW, live: true, recommendation: "pass" });
    expect(await hasNewerPreMatchPrediction(parent)).toBe(false);
    await insertPrediction({ matchId, createdAt: NOW, judgments: null });
    expect(await hasNewerPreMatchPrediction(parent)).toBe(true);
  });
});

describe("getFrozenSelectionOdds", () => {
  it("odds do pai por seleção, na ordem do mercado", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    const id = await insertPrediction({
      matchId,
      createdAt: NOW,
      odds: { over: "1.950", under: "1.900" },
    });
    expect(await getFrozenSelectionOdds(id)).toEqual([
      { key: "over", odd: 1.95 },
      { key: "under", odd: 1.9 },
    ]);
  });
});

describe("reconferência nas métricas (ADR 0020 adendo)", () => {
  it("fora do dashboard (Yield/CLV/Kelly) e da closing line; dentro da calibração", async () => {
    const matchId = await insertMatch({ kickoffAt: new Date(NOW.getTime() + min(40)) });
    const parent = await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(600)),
      recommendation: "pass",
      odds: { over: "1.950", under: "1.900" },
    });
    // A reconferência virou aposta: mais nova, mesmo balde.
    const recheck = await insertPrediction({
      matchId,
      createdAt: new Date(NOW.getTime() - min(5)),
      judgments: judgments({ recheck: recheckOf(parent) }),
      odds: { over: "1.950", under: "1.900" },
      modelVersion: "claude-x;engine=code_jev;lambda=dixon_coles;recheck=lineup_v1",
    });

    const userRows = (await getUserDashboardRows(ids.userA)).map((r) => r.predictionId);
    expect(userRows).toEqual([parent]);
    const allRows = (await getAllDashboardRows()).map((r) => r.predictionId);
    expect(allRows).not.toContain(recheck);

    // Pai é pass, a virada é a única non-pass: nenhum crédito de closing line.
    expect(
      await getNonPassPredictionsNearKickoff({ now: NOW, lookaheadMs: min(90) })
    ).toEqual([]);

    // Calibração mantém a reconferência (segmentada pela tag), depois de liquidada.
    for (const id of [parent, recheck]) {
      await realDb.insert(schema.predictionOutcomes).values({
        predictionId: id,
        resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
        result: id === parent ? "void" : "won",
        profitUnits: "0",
      });
    }
    await realDb
      .update(schema.matches)
      .set({ status: "finished", homeScore: 2, awayScore: 1 })
      .where(eq(schema.matches.id, matchId));
    const cal = await getMarketCalibrationRows(["over_under"]);
    expect(cal).toHaveLength(2);
    expect(cal.find((r) => r.isBet)?.engineConfig).toContain("recheck=lineup_v1");
    expect(cal.find((r) => !r.isBet)?.engineConfig).not.toContain("recheck");
  });
});
