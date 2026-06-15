// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM) das queries de CLV (#180): a leitura
// da closing line (janela [KO−40min, KO], line-aware, JS-reduce) e o filtro de
// candidatos near-KO (non-pass, janela, status). Cobrem o que stub de chain não pega:
// make_interval relativo ao kickoff, exclusão de snapshot pós-KO/velho, predicado de
// linha, e a exclusão de pass (AC do #180). Roda em `node` (pglite falha sob jsdom).
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
  getClosingSnapshotForDetail,
  getClosingSnapshotsForPredictions,
} from "@/lib/db/queries/clv-snapshots";
import { getNonPassPredictionsNearKickoff } from "@/lib/db/queries/predictions";
import { insertSelectionOddsSnapshotsBatch } from "@/lib/db/queries/odds-snapshots";

const ids: {
  matchId: string;
  ouMarketId: string;
  ouOver: string;
  ouUnder: string;
  userId: string;
  aiCallId: string;
} = {} as never;

const KO = new Date("2026-05-15T19:00:00Z");

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

  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-clv-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: KO,
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;

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

  const [u] = await base
    .insert(schema.users)
    .values({ email: "clv@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [ai] = await base
    .insert(schema.aiCalls)
    .values({
      userId: u.id,
      matchId: m.id,
      model: "claude-sonnet-4-5-20250929",
      promptVersion: "over_under_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0.000001",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ai.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.selectionOddsSnapshots);
  await realDb.delete(schema.predictions);
});

function snap(
  selectionId: string,
  odd: string,
  capturedAt: Date,
  overroundPct = "3.50",
  line: number | null = 2.5,
) {
  return {
    matchId: ids.matchId,
    marketId: ids.ouMarketId,
    selectionId,
    marketParams: line === null ? null : { line },
    odd,
    overroundPct,
    bookmaker: "Pinnacle",
    capturedAt,
  };
}

const minutesBeforeKO = (m: number) => new Date(KO.getTime() - m * 60 * 1000);

// Factory (NÃO const de módulo): `ids` só é populado no beforeAll, depois do load.
function input(opts: {
  predictionId: string;
  line?: number | null;
  selectionId?: string | null;
}) {
  return {
    predictionId: opts.predictionId,
    matchId: ids.matchId,
    marketId: ids.ouMarketId,
    selectionId: opts.selectionId === undefined ? ids.ouOver : opts.selectionId,
    line: opts.line === undefined ? 2.5 : opts.line,
  };
}

describe("getClosingSnapshotsForPredictions — janela [KO−40min, KO]", () => {
  it("retorna o ÚLTIMO snapshot da seleção dentro da janela (+ overround)", async () => {
    await insertSelectionOddsSnapshotsBatch([
      snap(ids.ouOver, "2.000", minutesBeforeKO(20), "4.00"),
      snap(ids.ouOver, "1.900", minutesBeforeKO(5), "3.50"), // mais perto do KO → vence
    ]);
    const map = await getClosingSnapshotsForPredictions([
      input({ predictionId: "p" }),
    ]);
    const c = map.get("p");
    expect(c).toBeDefined();
    expect(c!.oddClose).toBe("1.900");
    expect(c!.overroundPctClose).toBe("3.50");
    expect(c!.capturedAt.getTime()).toBe(minutesBeforeKO(5).getTime());
  });

  it("snapshot VELHO (fora dos 40min) → ausente (CLV null, honesto)", async () => {
    await insertSelectionOddsSnapshotsBatch([
      snap(ids.ouOver, "2.100", minutesBeforeKO(120)), // KO−2h, fora da janela
    ]);
    const map = await getClosingSnapshotsForPredictions([
      input({ predictionId: "p" }),
    ]);
    expect(map.has("p")).toBe(false);
  });

  it("snapshot APÓS o kickoff → excluído", async () => {
    await insertSelectionOddsSnapshotsBatch([
      snap(ids.ouOver, "1.800", new Date(KO.getTime() + 5 * 60 * 1000)),
    ]);
    const map = await getClosingSnapshotsForPredictions([
      input({ predictionId: "p" }),
    ]);
    expect(map.has("p")).toBe(false);
  });

  it("line-aware: snapshot 3.5 não satisfaz uma predição na linha 2.5", async () => {
    await insertSelectionOddsSnapshotsBatch([
      snap(ids.ouOver, "2.600", minutesBeforeKO(10), "3.50", 3.5),
    ]);
    const map = await getClosingSnapshotsForPredictions([
      input({ predictionId: "p", line: 2.5 }),
    ]);
    expect(map.has("p")).toBe(false);
  });

  it("input com selectionId null (pass) é ignorado", async () => {
    const map = await getClosingSnapshotsForPredictions([
      input({ predictionId: "pass-1", selectionId: null }),
    ]);
    expect(map.size).toBe(0);
  });
});

describe("getClosingSnapshotForDetail — guarda do drill-down", () => {
  beforeEach(async () => {
    await insertSelectionOddsSnapshotsBatch([
      snap(ids.ouOver, "1.900", minutesBeforeKO(10)),
    ]);
  });

  it("non-pass com seleção/mercado → retorna a closing line", async () => {
    const c = await getClosingSnapshotForDetail({
      id: "p",
      matchId: ids.matchId,
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
      marketParams: { line: 2.5 },
    });
    expect(c?.oddClose).toBe("1.900");
  });

  it("recommendation 'pass' → null mesmo com snapshot existente (guarda)", async () => {
    const c = await getClosingSnapshotForDetail({
      id: "p",
      matchId: ids.matchId,
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver, // mesmo com selectionId, pass não tem CLV
      recommendation: "pass",
      marketParams: { line: 2.5 },
    });
    expect(c).toBeNull();
  });

  it("marketId/selectionId null → null", async () => {
    expect(
      await getClosingSnapshotForDetail({
        id: "p",
        matchId: ids.matchId,
        marketId: null,
        selectionId: ids.ouOver,
        recommendation: "over",
        marketParams: { line: 2.5 },
      }),
    ).toBeNull();
  });
});

let predSeq = 0;
async function insertPrediction(args: {
  recommendation: string;
  selectionId: string | null;
  kickoffAt: Date;
  status?: "scheduled" | "live" | "finished";
}) {
  // Cada predição precisa do seu próprio match (a query agrupa por jogo). Seq garante
  // externalId único (matches.external_id é unique).
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-pred-${predSeq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: args.kickoffAt,
      status: args.status ?? "scheduled",
    })
    .returning({ id: schema.matches.id });
  await realDb.insert(schema.predictions).values({
    matchId: m.id,
    userId: ids.userId,
    aiCallId: ids.aiCallId,
    marketId: ids.ouMarketId,
    selectionId: args.selectionId,
    recommendation: args.recommendation,
    confidencePct: "55.00",
    rationale: "r",
    keyFactors: ["f"],
    modelVersion: "claude-sonnet-4-5-20250929",
    promptVersion: "over_under_v1",
  });
  return m.id;
}

describe("getNonPassPredictionsNearKickoff — candidatos da captura", () => {
  const NOW = new Date("2026-07-01T12:00:00Z");
  const LOOKAHEAD = 90 * 60 * 1000;

  it("inclui non-pass na janela; exclui pass, fora-da-janela, passado e finished", async () => {
    const near = await insertPrediction({
      recommendation: "over",
      selectionId: ids.ouOver,
      kickoffAt: new Date(NOW.getTime() + 30 * 60 * 1000), // KO em 30min
    });
    await insertPrediction({
      recommendation: "pass", // pass → excluído (AC: sem captura pra pass)
      selectionId: null,
      kickoffAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    });
    await insertPrediction({
      recommendation: "over",
      selectionId: ids.ouOver,
      kickoffAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000), // >90min → fora
    });
    await insertPrediction({
      recommendation: "over",
      selectionId: ids.ouOver,
      kickoffAt: new Date(NOW.getTime() - 10 * 60 * 1000), // já passou do KO
    });
    await insertPrediction({
      recommendation: "over",
      selectionId: ids.ouOver,
      kickoffAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      status: "finished", // status fora de scheduled/live
    });

    const got = await getNonPassPredictionsNearKickoff({
      now: NOW,
      lookaheadMs: LOOKAHEAD,
    });
    expect(got).toHaveLength(1);
    expect(got[0].match.id).toBe(near);
    expect(got[0].marketKeys).toEqual(["over_under"]);
  });
});
