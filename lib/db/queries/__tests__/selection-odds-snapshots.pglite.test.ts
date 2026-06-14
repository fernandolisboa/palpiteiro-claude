// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM). Rodam as migrations reais 1x —
// o catálogo over_under (0009) E match_result+home/draw/away (0014/#173) já vêm
// seedados pelas migrations; o setup só LÊ os ids. Cobrem o que stub de chain não pega:
// DISTINCT-ON coerente, onConflict de 5 col, predicado jsonb de line, coerência da
// captura. Roda em `node` (pglite falha sob jsdom: r.arrayBuffer is not a function).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

// `@/lib/db` é mockado pra apontar pro pglite. `realDb` é preenchido no beforeAll
// (depois das migrations). O Proxy delega tudo — incluindo `.batch`, que pglite
// não tem nativamente, então adicionamos um shim que roda os builders numa
// transação real (exercita o contrato de "builders não-awaited").
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
  getLatestFreshSelectionOddsSnapshots,
  getLatestSelectionOddsSnapshots,
  insertSelectionOddsSnapshotsBatch,
  type SelectionSnapshotRow,
} from "@/lib/db/queries/odds-snapshots";

const ids: {
  matchId: string;
  ouMarketId: string;
  ouOver: string;
  ouUnder: string;
  mrMarketId: string;
  mrHome: string;
  mrDraw: string;
  mrAway: string;
} = {} as never;

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // Shim de batch: pglite (PgDatabase) não tem .batch (só neon-http). pglite é
  // single-connection — aninhar uma query do client base dentro de
  // `client.transaction` trava; awaitamos os builders em sequência (este arquivo
  // nem chama .batch — usa os builders direto — mas mantemos o shim por simetria).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (base as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  // ── match (FK das snapshots) ───────────────────────────────────────────────
  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-pglite-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;

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

  // match_result agora é seedado pela migration 0014 (#173) — lê o row semeado
  // (como over_under acima), não insere (insert duplicado viola markets_key_unique).
  const [mr] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "match_result"));
  ids.mrMarketId = mr.id;
  const mrSels = await base
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, mr.id));
  ids.mrHome = mrSels.find((s) => s.key === "home")!.id;
  ids.mrDraw = mrSels.find((s) => s.key === "draw")!.id;
  ids.mrAway = mrSels.find((s) => s.key === "away")!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.selectionOddsSnapshots);
});

function ouRow(
  selectionId: string,
  odd: string,
  capturedAt: Date,
  overroundPct = "3.50",
  bookmaker = "Pinnacle",
  line = 2.5,
): SelectionSnapshotRow {
  return {
    matchId: ids.matchId,
    marketId: ids.ouMarketId,
    selectionId,
    marketParams: { line },
    odd,
    overroundPct,
    bookmaker,
    capturedAt,
  };
}

describe("selection_odds_snapshots — real Postgres (pglite)", () => {
  it("DISTINCT ON returns the latest capture, coherent (one capturedAt+bookmaker)", async () => {
    const t1 = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T11:00:00Z");
    // captura antiga (Book A) + captura nova (Book B) — a nova deve vencer
    await insertSelectionOddsSnapshotsBatch([
      ouRow(ids.ouOver, "1.800", t1, "4.00", "Book A"),
      ouRow(ids.ouUnder, "2.000", t1, "4.00", "Book A"),
    ]);
    await insertSelectionOddsSnapshotsBatch([
      ouRow(ids.ouOver, "1.900", t2, "3.50", "Pinnacle"),
      ouRow(ids.ouUnder, "1.950", t2, "3.50", "Pinnacle"),
    ]);

    const latest = await getLatestSelectionOddsSnapshots({
      matchId: ids.matchId,
      dbMarketKey: "over_under",
      params: { line: 2.5 },
    });
    expect(latest).not.toBeNull();
    expect(latest!.bookmaker).toBe("Pinnacle");
    expect(latest!.capturedAt.getTime()).toBe(t2.getTime());
    const byKey = new Map(latest!.selections.map((s) => [s.key, s.odd]));
    expect(byKey.get("over")).toBe("1.900");
    expect(byKey.get("under")).toBe("1.950");
  });

  it("onConflictDoNothing on the 5-col key: same provider data + DIFFERENT write-time now → 2 rows", async () => {
    const t1 = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T10:30:00Z");
    // MESMAS odds/bookmaker, mas captured_at distinto (now de escrita) → chave de 5
    // col difere → 2 capturas (histórico chaveado no captured_at, não no last_update).
    await insertSelectionOddsSnapshotsBatch([ouRow(ids.ouOver, "1.900", t1)]);
    await insertSelectionOddsSnapshotsBatch([ouRow(ids.ouOver, "1.900", t2)]);
    const all = await realDb.select().from(schema.selectionOddsSnapshots);
    expect(all).toHaveLength(2);

    // Re-inserir a MESMA chave (mesmo captured_at) = no-op (idempotente).
    await insertSelectionOddsSnapshotsBatch([ouRow(ids.ouOver, "9.999", t1)]);
    const after = await realDb.select().from(schema.selectionOddsSnapshots);
    expect(after).toHaveLength(2);
    // a odd original (1.900) sobrevive — DO NOTHING não sobrescreve
    const t1Row = after.find((r) => r.capturedAt.getTime() === t1.getTime());
    expect(t1Row!.odd).toBe("1.900");
  });

  it("jsonb line predicate: a 3.5 row never satisfies a 2.5 read", async () => {
    const t = new Date("2026-05-15T10:00:00Z");
    // captura na linha 3.5
    await insertSelectionOddsSnapshotsBatch([
      ouRow(ids.ouOver, "2.500", t, "3.50", "Pinnacle", 3.5),
      ouRow(ids.ouUnder, "1.550", t, "3.50", "Pinnacle", 3.5),
    ]);
    const read25 = await getLatestSelectionOddsSnapshots({
      matchId: ids.matchId,
      dbMarketKey: "over_under",
      params: { line: 2.5 },
    });
    expect(read25).toBeNull();
    const read35 = await getLatestSelectionOddsSnapshots({
      matchId: ids.matchId,
      dbMarketKey: "over_under",
      params: { line: 3.5 },
    });
    expect(read35).not.toBeNull();
    expect(read35!.selections).toHaveLength(2);
  });

  it("hard-fails on an incoherent capture (rows diverge in capturedAt/bookmaker)", async () => {
    const t1 = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T11:00:00Z");
    // over capturado em t2/Book B, under só em t1/Book A → DISTINCT ON traz over@t2 +
    // under@t1 (cada seleção sua última), divergentes → coerência precisa falhar.
    await insertSelectionOddsSnapshotsBatch([
      ouRow(ids.ouUnder, "2.000", t1, "4.00", "Book A"),
    ]);
    await insertSelectionOddsSnapshotsBatch([
      ouRow(ids.ouOver, "1.900", t2, "3.50", "Book B"),
    ]);
    await expect(
      getLatestSelectionOddsSnapshots({
        matchId: ids.matchId,
        dbMarketKey: "over_under",
        params: { line: 2.5 },
      }),
    ).rejects.toThrow(/incoerente/);
  });

  it("hard-fails on an incomplete capture (faltando seleção do mercado)", async () => {
    const t = new Date("2026-05-15T10:00:00Z");
    // só 'over' gravado — captura coerente (1 row) mas PARCIAL: over_under tem 2
    // seleções. Sem a guarda devolveria um bundle curto que alimentaria
    // overround/edge sobre mercado incompleto (o #165 consome `selections`).
    await insertSelectionOddsSnapshotsBatch([ouRow(ids.ouOver, "1.900", t)]);
    await expect(
      getLatestSelectionOddsSnapshots({
        matchId: ids.matchId,
        dbMarketKey: "over_under",
        params: { line: 2.5 },
      }),
    ).rejects.toThrow(/incompleta/);
  });

  it("getLatestFreshSelectionOddsSnapshots respects the strict-< TTL boundary", async () => {
    const now = new Date("2026-05-15T12:00:00Z");
    const captured = new Date(now.getTime() - 29 * 60 * 1000); // fresca
    await insertSelectionOddsSnapshotsBatch([
      ouRow(ids.ouOver, "1.900", captured),
      ouRow(ids.ouUnder, "1.950", captured),
    ]);
    const fresh = await getLatestFreshSelectionOddsSnapshots(
      { matchId: ids.matchId, dbMarketKey: "over_under", params: { line: 2.5 } },
      now,
    );
    expect(fresh).not.toBeNull();

    const staleNow = new Date(captured.getTime() + 30 * 60 * 1000); // idade == TTL
    const stale = await getLatestFreshSelectionOddsSnapshots(
      { matchId: ids.matchId, dbMarketKey: "over_under", params: { line: 2.5 } },
      staleNow,
    );
    expect(stale).toBeNull();
  });

  it("match_result (N=3) write→read coherent (1X2 candidate set)", async () => {
    const t = new Date("2026-05-15T10:00:00Z");
    await insertSelectionOddsSnapshotsBatch([
      {
        matchId: ids.matchId,
        marketId: ids.mrMarketId,
        selectionId: ids.mrHome,
        marketParams: null,
        odd: "2.100",
        overroundPct: "5.00",
        bookmaker: "Pinnacle",
        capturedAt: t,
      },
      {
        matchId: ids.matchId,
        marketId: ids.mrMarketId,
        selectionId: ids.mrDraw,
        marketParams: null,
        odd: "3.400",
        overroundPct: "5.00",
        bookmaker: "Pinnacle",
        capturedAt: t,
      },
      {
        matchId: ids.matchId,
        marketId: ids.mrMarketId,
        selectionId: ids.mrAway,
        marketParams: null,
        odd: "3.900",
        overroundPct: "5.00",
        bookmaker: "Pinnacle",
        capturedAt: t,
      },
    ]);
    const latest = await getLatestSelectionOddsSnapshots({
      matchId: ids.matchId,
      dbMarketKey: "match_result",
    });
    expect(latest).not.toBeNull();
    expect(latest!.selections).toHaveLength(3);
    const byKey = new Map(latest!.selections.map((s) => [s.key, s.odd]));
    expect(byKey.get("home")).toBe("2.100");
    expect(byKey.get("draw")).toBe("3.400");
    expect(byKey.get("away")).toBe("3.900");
    expect(latest!.bookmaker).toBe("Pinnacle");
  });
});
