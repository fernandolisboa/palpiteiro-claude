// @vitest-environment node
//
// getLatestSelectionOddsSnapshotsForMatches (batch, best-effort, ordenado) contra
// Postgres REAL via pglite. Cobre o que stub de chain não pega: DISTINCT ON por
// (match, selection) + JOIN em market_selections + ORDER BY canônico (sortOrder),
// e a degradação best-effort (omite match incompleto/incoerente em vez de throw —
// o reader roda no render síncrono da page/home). Roda em `node` (pglite falha sob
// jsdom). match_result (home/draw/away) já vem seedado pela migration 0014.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  getLatestSelectionOddsSnapshotsForMatches,
  insertSelectionOddsSnapshotsBatch,
  type SelectionSnapshotRow,
} from "@/lib/db/queries/odds-snapshots";

const ids: {
  matchA: string;
  matchB: string;
  matchC: string;
  mrMarketId: string;
  mrHome: string;
  mrDraw: string;
  mrAway: string;
} = {} as never;

async function seedMatch(externalId: string): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId,
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

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

  ids.matchA = await seedMatch("ext-batch-A");
  ids.matchB = await seedMatch("ext-batch-B");
  ids.matchC = await seedMatch("ext-batch-C");

  // match_result seedado pela 0014 — lê os ids (insert duplicado viola unique).
  const [mr] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "match_result"));
  ids.mrMarketId = mr.id;
  const sels = await base
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, mr.id));
  ids.mrHome = sels.find((s) => s.key === "home")!.id;
  ids.mrDraw = sels.find((s) => s.key === "draw")!.id;
  ids.mrAway = sels.find((s) => s.key === "away")!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.selectionOddsSnapshots);
});

function mrRow(
  matchId: string,
  selectionId: string,
  odd: string,
  capturedAt: Date,
  bookmaker = "Pinnacle",
): SelectionSnapshotRow {
  return {
    matchId,
    marketId: ids.mrMarketId,
    selectionId,
    marketParams: null,
    odd,
    overroundPct: "5.00",
    bookmaker,
    capturedAt,
  };
}

describe("getLatestSelectionOddsSnapshotsForMatches — batch best-effort (pglite)", () => {
  it("empty matchIds → empty Map (sem query)", async () => {
    const out = await getLatestSelectionOddsSnapshotsForMatches([], "match_result");
    expect(out.size).toBe(0);
  });

  it("ordena por sortOrder (home,draw,away) mesmo inserindo fora de ordem", async () => {
    const t = new Date("2026-05-15T10:00:00Z");
    // insere away→home→draw de propósito: o resultado tem que vir home,draw,away
    // (sortOrder 0/1/2), NÃO ordem de inserção nem selectionId (UUID).
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchA, ids.mrAway, "3.900", t),
      mrRow(ids.matchA, ids.mrHome, "2.100", t),
      mrRow(ids.matchA, ids.mrDraw, "3.400", t),
    ]);
    const out = await getLatestSelectionOddsSnapshotsForMatches(
      [ids.matchA],
      "match_result",
    );
    const a = out.get(ids.matchA);
    expect(a).toBeDefined();
    expect(a!.selections.map((s) => s.key)).toEqual(["home", "draw", "away"]);
    expect(a!.selections.map((s) => s.odd)).toEqual(["2.100", "3.400", "3.900"]);
    expect(a!.bookmaker).toBe("Pinnacle");
  });

  it("DISTINCT ON traz a última captura por seleção (mais recente vence)", async () => {
    const t1 = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T11:00:00Z");
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchA, ids.mrHome, "2.500", t1, "Book A"),
      mrRow(ids.matchA, ids.mrDraw, "3.000", t1, "Book A"),
      mrRow(ids.matchA, ids.mrAway, "3.000", t1, "Book A"),
    ]);
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchA, ids.mrHome, "2.100", t2, "Pinnacle"),
      mrRow(ids.matchA, ids.mrDraw, "3.400", t2, "Pinnacle"),
      mrRow(ids.matchA, ids.mrAway, "3.900", t2, "Pinnacle"),
    ]);
    const out = await getLatestSelectionOddsSnapshotsForMatches(
      [ids.matchA],
      "match_result",
    );
    const a = out.get(ids.matchA)!;
    expect(a.bookmaker).toBe("Pinnacle");
    expect(a.capturedAt.getTime()).toBe(t2.getTime());
    expect(a.selections.map((s) => s.odd)).toEqual(["2.100", "3.400", "3.900"]);
  });

  it("OMITE (best-effort, sem throw) match incompleto e match incoerente; multi-match", async () => {
    const t = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T11:00:00Z");
    // A: completo+coerente → presente
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchA, ids.mrHome, "2.100", t),
      mrRow(ids.matchA, ids.mrDraw, "3.400", t),
      mrRow(ids.matchA, ids.mrAway, "3.900", t),
    ]);
    // B: INCOMPLETO (falta 'away') → omitido
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchB, ids.mrHome, "2.000", t),
      mrRow(ids.matchB, ids.mrDraw, "3.300", t),
    ]);
    // C: INCOERENTE ('away' de outra captura/bookmaker) → omitido
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchC, ids.mrHome, "2.200", t, "Book A"),
      mrRow(ids.matchC, ids.mrDraw, "3.500", t, "Book A"),
    ]);
    await insertSelectionOddsSnapshotsBatch([
      mrRow(ids.matchC, ids.mrAway, "3.800", t2, "Book B"),
    ]);

    const out = await getLatestSelectionOddsSnapshotsForMatches(
      [ids.matchA, ids.matchB, ids.matchC],
      "match_result",
    );
    expect(out.has(ids.matchA)).toBe(true);
    expect(out.has(ids.matchB)).toBe(false);
    expect(out.has(ids.matchC)).toBe(false);
    expect(out.size).toBe(1);
  });
});
