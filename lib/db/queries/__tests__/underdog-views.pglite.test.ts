// @vitest-environment node
//
// Chances do azarão (#671, ADR 0073) contra Postgres REAL via pglite, com as migrations
// reais: UNIQUE (user, base) com ON CONFLICT que relê, última row por jogo, row
// inválida omitida pelo Zod e a coluna da flag com default true.
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

import { getEnableUnderdogView } from "@/lib/db/queries/ai-config";
import {
  findUnderdogViewForSnapshot,
  getLatestUnderdogView,
  getUnderdogViewForSnapshot,
  insertUnderdogView,
  replaceUnderdogView,
  type NewUnderdogView,
} from "@/lib/db/queries/underdog-views";
import { buildMatchModelSnapshot } from "@/lib/model-base/build-snapshot";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import type { UnderdogFacts, UnderdogNarrative } from "@/lib/underdog/types";

const ids = {} as {
  user: string;
  other: string;
  match: string;
  s1: string;
  s2: string;
};

const FACTS: UnderdogFacts = {
  side: "away",
  chances: { underdog: 26.1, draw: 28.9, favorite: 45 },
  scorelines: [{ home: 0, away: 1, pct: 8.2 }],
  scenarios: [{ id: "lead_30", beforePct: 26.1, afterPct: 58.7 }],
  signals: [{ kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 }],
  model: { source: "dixon_coles", jevApplied: false },
};
const NARRATIVE: UnderdogNarrative = {
  sentences: [
    {
      text: "O caminho passa por um gol cedo.",
      facts: ["C1"],
      verdict: "apoiada",
    },
  ],
  counterpoint: "Nos outros 74% o jogo empata ou o favorito vence.",
  counterpointSource: "llm",
  cut: 1,
  total: 4,
  verdicts: { apoiada: 2, exagerada: 1, sem_base: 1 },
  advocateFamily: "Sonnet",
};

function view(over: Partial<NewUnderdogView> = {}): NewUnderdogView {
  return {
    userId: ids.user,
    matchId: ids.match,
    modelSnapshotId: ids.s1,
    underdogSide: "away",
    facts: FACTS,
    narrative: NARRATIVE,
    narrativeSource: "llm",
    versions: {
      calc: "underdog_calc_v1",
      advocate: "underdog_advocate_v1",
      review: "underdog_review_v1",
      matchModel: "match_model_v1",
    },
    ...over,
  };
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u, o] = await realDb
    .insert(schema.users)
    .values([{ email: "a@example.com" }, { email: "b@example.com" }])
    .returning({ id: schema.users.id });
  ids.user = u.id;
  ids.other = o.id;
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-ud-1",
      league: "brasileirao_a",
      homeTeam: "SE Palmeiras",
      awayTeam: "CR Flamengo",
      kickoffAt: new Date("2026-11-21T19:30:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.match = m.id;
  const snap = (lh: number) =>
    buildMatchModelSnapshot({
      matchId: m.id,
      scoreline: {
        source: "dixon_coles",
        degraded: false,
        lambdaHome: lh,
        lambdaAway: 1.0,
        rho: -0.1,
        matrix: scorelineMatrix(lh, 1.0, { rho: -0.1 }),
      },
      neutral: false,
      jev: null,
    });
  const [s1, s2] = await realDb
    .insert(schema.matchModelSnapshots)
    .values([snap(1.4), snap(1.5)])
    .returning({ id: schema.matchModelSnapshots.id });
  ids.s1 = s1.id;
  ids.s2 = s2.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.underdogViews);
});

describe("underdog_views", () => {
  it("insert devolve a row validada; releitura por (user, base)", async () => {
    const rec = await insertUnderdogView(view());
    expect(rec).toMatchObject({
      matchId: ids.match,
      modelSnapshotId: ids.s1,
      side: "away",
      facts: FACTS,
      narrative: NARRATIVE,
      narrativeSource: "llm",
    });
    expect((await getUnderdogViewForSnapshot(ids.user, ids.s1))?.id).toBe(
      rec?.id
    );
    expect(await getUnderdogViewForSnapshot(ids.other, ids.s1)).toBeNull();
  });

  it("UNIQUE (user, base): o segundo insert não duplica e relê a que ficou", async () => {
    const first = await insertUnderdogView(view());
    const second = await insertUnderdogView(
      view({ narrativeSource: "template" })
    );
    expect(second?.id).toBe(first?.id);
    expect(second?.narrativeSource).toBe("llm");
    const count = await realDb
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.underdogViews);
    expect(count[0].n).toBe(1);
  });

  it("última row do usuário no jogo, de qualquer base; outro usuário não vê", async () => {
    await insertUnderdogView(
      view({ createdAt: new Date("2026-11-20T10:00:00Z") })
    );
    const newer = await insertUnderdogView(
      view({
        modelSnapshotId: ids.s2,
        createdAt: new Date("2026-11-21T10:00:00Z"),
      })
    );
    expect((await getLatestUnderdogView(ids.user, ids.match))?.id).toBe(
      newer?.id
    );
    expect(await getLatestUnderdogView(ids.other, ids.match)).toBeNull();
  });

  it("row com jsonb inválido é omitida (com log): cai na anterior válida", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const old = await insertUnderdogView(
      view({ createdAt: new Date("2026-11-20T10:00:00Z") })
    );
    const bad = await insertUnderdogView(
      view({
        modelSnapshotId: ids.s2,
        createdAt: new Date("2026-11-21T10:00:00Z"),
      })
    );
    await realDb.execute(
      sql`UPDATE underdog_views SET facts = '{"x":1}'::jsonb WHERE id = ${bad!.id}`
    );
    expect((await getLatestUnderdogView(ids.user, ids.match))?.id).toBe(
      old?.id
    );
    expect(await getUnderdogViewForSnapshot(ids.user, ids.s2)).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("find: existe-e-vale, existe-mas-inválida (record null) e não existe", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await findUnderdogViewForSnapshot(ids.user, ids.s1)).toBeNull();
    const rec = await insertUnderdogView(view());
    expect(
      (await findUnderdogViewForSnapshot(ids.user, ids.s1))?.record?.id
    ).toBe(rec?.id);
    await realDb.execute(
      sql`UPDATE underdog_views SET narrative = '{"x":1}'::jsonb WHERE id = ${rec!.id}`
    );
    expect(await findUnderdogViewForSnapshot(ids.user, ids.s1)).toEqual({
      record: null,
    });
    err.mockRestore();
  });

  it("replace troca a row da mesma base (inválida ou velha) sem duplicar", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await insertUnderdogView(view());
    await realDb.execute(
      sql`UPDATE underdog_views SET facts = '{"x":1}'::jsonb WHERE id = ${first!.id}`
    );
    const replaced = await replaceUnderdogView(
      view({
        narrativeSource: "template",
        versions: {
          calc: "underdog_calc_v2",
          advocate: "underdog_advocate_v1",
          review: "underdog_review_v1",
          matchModel: "match_model_v1",
        },
      })
    );
    expect(replaced).toMatchObject({
      id: first!.id,
      facts: FACTS,
      narrativeSource: "template",
    });
    expect(replaced?.versions.calc).toBe("underdog_calc_v2");
    const count = await realDb
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.underdogViews);
    expect(count[0].n).toBe(1);
    // Sem row: replace grava.
    const fresh = await replaceUnderdogView(view({ modelSnapshotId: ids.s2 }));
    expect(fresh?.modelSnapshotId).toBe(ids.s2);
    err.mockRestore();
  });

  it("row que não releria nunca é gravada (valida antes do insert)", async () => {
    await expect(
      insertUnderdogView(view({ facts: { x: 1 } as unknown as UnderdogFacts }))
    ).rejects.toThrow(/inválida/);
    await expect(
      replaceUnderdogView(view({ facts: { x: 1 } as unknown as UnderdogFacts }))
    ).rejects.toThrow(/inválida/);
    expect(await getLatestUnderdogView(ids.user, ids.match)).toBeNull();
  });

  it("base referenciada não pode ser apagada (FK restrict)", async () => {
    await insertUnderdogView(view());
    await expect(
      realDb
        .delete(schema.matchModelSnapshots)
        .where(eq(schema.matchModelSnapshots.id, ids.s1))
    ).rejects.toThrow();
  });

  it("flag enable_underdog_view: default true na row das migrations", async () => {
    expect(await getEnableUnderdogView()).toBe(true);
    await realDb
      .update(schema.aiConfig)
      .set({ enableUnderdogView: false })
      .where(eq(schema.aiConfig.id, 1));
    expect(await getEnableUnderdogView()).toBe(false);
    await realDb
      .update(schema.aiConfig)
      .set({ enableUnderdogView: true })
      .where(eq(schema.aiConfig.id, 1));
  });
});
