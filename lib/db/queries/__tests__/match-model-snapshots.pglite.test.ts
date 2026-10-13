// @vitest-environment node
//
// Base do modelo por jogo (#555, ADR 0052) contra Postgres REAL via pglite, com as
// migrations reais: insert/latest/batch (DISTINCT ON), row inválida omitida, heartbeat
// monotônico (GREATEST) e o reuso de respostas JEV com origem snapshot.
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
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
    },
  ),
}));

import {
  findReusableSnapshotJudgments,
  getLatestMatchModelSnapshot,
  getLatestMatchModelSnapshotsForMatches,
  getLatestMatchModelSnapshotWithKickoff,
  insertMatchModelSnapshot,
  touchMatchModelSnapshot,
  type NewMatchModelSnapshot,
} from "@/lib/db/queries/match-model-snapshots";
import { buildMatchModelSnapshot } from "@/lib/model-base/build-snapshot";
import type { MatchModelJudgments } from "@/lib/model-base/types";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const ids: { m1: string; m2: string } = {} as never;
const KICKOFF = new Date("2026-05-15T19:00:00Z");
const NOW = new Date("2026-05-14T12:00:00Z");

const ANSWERS = Object.fromEntries(
  JUDGMENT_QUESTION_IDS.map((id) => [id, { value: 0.2, confidence: null }]),
) as JudgmentAnswers;

function judgments(over: Partial<MatchModelJudgments> = {}): MatchModelJudgments {
  return {
    applied: true,
    answers: ANSWERS,
    multipliers: null,
    versions: {
      judgments: "jev_judgments_v1",
      weights: "judgment_weights_v1",
      jevModel: "jev-1.13.0",
      jevModelServed: "jev-1.13.0",
    },
    failure: null,
    stateHash: "hash-a",
    aiCallId: null,
    reusedFromPredictionId: null,
    reusedFromModelSnapshotId: null,
    ...over,
  };
}

function row(
  matchId: string,
  over: Partial<NewMatchModelSnapshot> = {},
): NewMatchModelSnapshot {
  const base = buildMatchModelSnapshot({
    matchId,
    scoreline: {
      source: "dixon_coles",
      degraded: false,
      lambdaHome: 1.5,
      lambdaAway: 1.1,
      rho: -0.08,
      matrix: scorelineMatrix(1.5, 1.1, { rho: -0.08 }),
    },
    neutral: false,
    jev: null,
  });
  return { ...base, computedAt: NOW, checkedAt: NOW, ...over };
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [a, b] = await realDb
    .insert(schema.matches)
    .values([
      {
        externalId: "ext-mm-1",
        league: "brasileirao_a",
        homeTeam: "CR Flamengo",
        awayTeam: "Fluminense FC",
        kickoffAt: KICKOFF,
      },
      {
        externalId: "ext-mm-2",
        league: "brasileirao_a",
        homeTeam: "SE Palmeiras",
        awayTeam: "SC Corinthians",
        kickoffAt: KICKOFF,
      },
    ])
    .returning({ id: schema.matches.id });
  ids.m1 = a.id;
  ids.m2 = b.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.matchModelSnapshots);
});

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("insert / latest / batch", () => {
  it("insert devolve o id e o latest lê a row validada", async () => {
    const id = await insertMatchModelSnapshot(row(ids.m1));
    const latest = await getLatestMatchModelSnapshot(ids.m1);
    expect(latest?.id).toBe(id);
    expect(latest?.lambdaSource).toBe("dixon_coles");
    expect(latest?.rho).toBe(-0.08);
    expect(latest?.probabilities.over_under["2.5"].over).toBeGreaterThan(0);
    expect(latest?.topScorelines).toHaveLength(5);
  });

  it("batch: a mais recente por jogo (DISTINCT ON), jogo sem base fora do Map", async () => {
    await insertMatchModelSnapshot(row(ids.m1, { computedAt: hoursAgo(10) }));
    const newest = await insertMatchModelSnapshot(
      row(ids.m1, { computedAt: hoursAgo(1), lambdaHome: 1.7 }),
    );
    const m2 = await insertMatchModelSnapshot(row(ids.m2));
    const out = await getLatestMatchModelSnapshotsForMatches([
      ids.m1,
      ids.m2,
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(out.size).toBe(2);
    expect(out.get(ids.m1)?.id).toBe(newest);
    expect(out.get(ids.m2)?.id).toBe(m2);
    expect(await getLatestMatchModelSnapshotsForMatches([])).toEqual(new Map());
  });

  it("row com jsonb inválido é omitida (com log), nunca lança", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await insertMatchModelSnapshot(row(ids.m1));
    await realDb.execute(
      sql`UPDATE match_model_snapshots SET probabilities = '{"x":1}'::jsonb`,
    );
    expect(await getLatestMatchModelSnapshot(ids.m1)).toBeNull();
    expect((await getLatestMatchModelSnapshotsForMatches([ids.m1])).size).toBe(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("getLatestMatchModelSnapshotWithKickoff traz o kickoff do jogo", async () => {
    const id = await insertMatchModelSnapshot(row(ids.m1));
    const out = await getLatestMatchModelSnapshotWithKickoff(ids.m1);
    expect(out?.snapshot.id).toBe(id);
    expect(out?.kickoffAt.toISOString()).toBe(KICKOFF.toISOString());
    expect(await getLatestMatchModelSnapshotWithKickoff(ids.m2)).toBeNull();
  });
});

describe("touchMatchModelSnapshot (heartbeat)", () => {
  it("só mexe em checked_at e nunca recua (GREATEST)", async () => {
    const id = await insertMatchModelSnapshot(row(ids.m1));
    const before = await getLatestMatchModelSnapshot(ids.m1);

    const later = new Date(NOW.getTime() + 6 * 3_600_000);
    await touchMatchModelSnapshot(id, later);
    const after = await getLatestMatchModelSnapshot(ids.m1);
    expect(after?.checkedAt.toISOString()).toBe(later.toISOString());
    expect(after?.computedAt.toISOString()).toBe(
      before?.computedAt.toISOString(),
    );
    expect({ ...after, checkedAt: null }).toEqual({
      ...before,
      checkedAt: null,
    });

    await touchMatchModelSnapshot(id, hoursAgo(24));
    const stale = await realDb
      .select({ checkedAt: schema.matchModelSnapshots.checkedAt })
      .from(schema.matchModelSnapshots)
      .where(eq(schema.matchModelSnapshots.id, id));
    expect(stale[0].checkedAt.toISOString()).toBe(later.toISOString());
  });
});

describe("findReusableSnapshotJudgments", () => {
  const find = (stateHash = "hash-a", since = hoursAgo(12)) =>
    findReusableSnapshotJudgments({
      matchId: ids.m1,
      judgmentsVersion: "jev_judgments_v1",
      weightsVersion: "judgment_weights_v1",
      jevModel: "jev-1.13.0",
      stateHash,
      since,
    });

  const withJev = (j: MatchModelJudgments, checkedAt = hoursAgo(1)) =>
    row(ids.m1, { jevStatus: "applied", judgments: j, checkedAt });

  it("acha a base aplicada com o mesmo hash e versões; a de checked_at mais recente vence", async () => {
    await insertMatchModelSnapshot(
      withJev(judgments({ aiCallId: "call-old" }), hoursAgo(5)),
    );
    const newest = await insertMatchModelSnapshot(
      withJev(judgments({ aiCallId: "call-new" }), hoursAgo(1)),
    );
    const out = await find();
    expect(out?.snapshotId).toBe(newest);
    expect(out?.judgments.aiCallId).toBe("call-new");
    expect(out?.judgments.answers).toEqual(ANSWERS);
  });

  it("ignora hash/versões/modelo diferentes, applied=false, answers JSON null, outro jogo e fora da janela", async () => {
    const v = judgments().versions;
    await insertMatchModelSnapshot(withJev(judgments({ stateHash: "hash-b" })));
    await insertMatchModelSnapshot(
      withJev(judgments({ versions: { ...v, weights: "judgment_weights_v2" } })),
    );
    await insertMatchModelSnapshot(
      withJev(judgments({ versions: { ...v, judgments: "jev_judgments_v2" } })),
    );
    await insertMatchModelSnapshot(
      withJev(judgments({ versions: { ...v, jevModel: "jev-1.14.0" } })),
    );
    await insertMatchModelSnapshot(
      withJev(judgments({ applied: false, answers: null })),
    );
    // applied=true com answers JSON null (jsonb 'null' não é SQL NULL).
    await insertMatchModelSnapshot(withJev(judgments({ answers: null })));
    await insertMatchModelSnapshot(
      row(ids.m2, { jevStatus: "applied", judgments: judgments() }),
    );
    await insertMatchModelSnapshot(withJev(judgments(), hoursAgo(13)));
    await insertMatchModelSnapshot(row(ids.m1));
    expect(await find()).toBeNull();
  });
});
