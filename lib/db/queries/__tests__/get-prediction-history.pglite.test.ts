// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM) pra getPredictionHistoryForMatch
// (#204) — a query rica do histórico: escopo por usuário (sem leak, AC2), ordem
// newest-first + tiebreak determinístico, SEM limit (história completa), resolução
// de marketKey (LEFT join) e o candidate set BATCHEADO (inArray) por predição.
// Substitui o teste mock-based antigo (predictions.test.ts): a query agora dispara
// 2 selects + usa asc/inArray, então o stub de chain único não a cobre — DB real
// vale mais e cobre as MESMAS invariantes (scoping/ordem/no-limit) + a forma nova.
// As migrations rodam 1x e já seedam over_under (0009) e match_result+seleções
// (0014). Roda em `node` (pglite falha sob jsdom: r.arrayBuffer is not a function).
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

import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";

const ids: {
  userId: string;
  otherUserId: string;
  matchId: string;
  otherMatchId: string;
  aiCallId: string;
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
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "history@pglite.test", role: "admin", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  // 2º usuário — pra provar o escopo por userId (AC2: sem cross-user leak).
  const [other] = await base
    .insert(schema.users)
    .values({ email: "history-other@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.otherUserId = other.id;

  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-history-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;

  // 2º jogo — pra provar o escopo por matchId (uma predição de OUTRO jogo do MESMO
  // usuário não pode vazar pra este jogo).
  const [m2] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-history-2",
      league: "brasileirao_a",
      homeTeam: "SE Palmeiras",
      awayTeam: "SC Corinthians",
      kickoffAt: new Date("2026-05-16T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.otherMatchId = m2.id;

  const [ac] = await base
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId: ids.matchId,
      provider: "anthropic",
      model: "claude-opus-4-8",
      promptVersion: "match_result_v1",
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
  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
});

async function insertPrediction(values: {
  userId?: string;
  matchId?: string;
  marketId?: string | null;
  selectionId?: string | null;
  recommendation: string;
  createdAt?: Date;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: values.matchId ?? ids.matchId,
      userId: values.userId ?? ids.userId,
      aiCallId: ids.aiCallId,
      marketId: values.marketId ?? null,
      selectionId: values.selectionId ?? null,
      recommendation: values.recommendation,
      confidencePct: "60.00",
      rationale: "r",
      keyFactors: ["a"],
      modelVersion: "claude-opus-4-8",
      promptVersion: "v1",
      createdAt: values.createdAt ?? new Date("2026-05-10T12:00:00Z"),
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

describe("getPredictionHistoryForMatch — escopo e ordem", () => {
  it("escopa por userId — NUNCA vaza a predição de outro usuário (AC2)", async () => {
    const mine = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
    });
    const theirs = await insertPrediction({
      userId: ids.otherUserId,
      marketId: ids.ouMarketId,
      selectionId: ids.ouUnder,
      recommendation: "under",
    });

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    expect(out[0].prediction.id).toBe(mine);
    expect(out.map((r) => r.prediction.id)).not.toContain(theirs);
  });

  it("escopa por matchId — predição de OUTRO jogo do mesmo usuário não vaza", async () => {
    const thisMatch = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
    });
    const otherMatch = await insertPrediction({
      matchId: ids.otherMatchId,
      marketId: ids.ouMarketId,
      selectionId: ids.ouUnder,
      recommendation: "under",
    });

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    expect(out[0].prediction.id).toBe(thisMatch);
    expect(out.map((r) => r.prediction.id)).not.toContain(otherMatch);
  });

  it("popula o leftJoin de aiCall (costUsd round-trips)", async () => {
    await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
    });
    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out[0].aiCall).not.toBeNull();
    expect(out[0].aiCall?.costUsd).toBe("0.010000");
  });

  it("retorna a história COMPLETA (sem limit) em ordem newest-first", async () => {
    const p1 = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
      createdAt: new Date("2026-05-10T12:00:00Z"),
    });
    const p2 = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouUnder,
      recommendation: "under",
      createdAt: new Date("2026-05-10T13:00:00Z"),
    });
    const p3 = await insertPrediction({
      marketId: ids.mrMarketId,
      selectionId: ids.mrHome,
      recommendation: "home",
      createdAt: new Date("2026-05-10T14:00:00Z"),
    });

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    // ≥3 retornadas = regression-guard contra um .limit() acidental.
    expect(out.map((r) => r.prediction.id)).toEqual([p3, p2, p1]);
  });

  it("desempata createdAt igual por desc(id) — ordem DETERMINÍSTICA entre requests", async () => {
    const sameTime = new Date("2026-05-10T12:00:00Z");
    const a = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
      createdAt: sameTime,
    });
    const b = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouUnder,
      recommendation: "under",
      createdAt: sameTime,
    });

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(2);
    // Tiebreak desc(id): o id lexicograficamente maior vem primeiro, sempre.
    const expected = [a, b].sort((x, y) => (x > y ? -1 : 1));
    expect(out.map((r) => r.prediction.id)).toEqual(expected);
  });
});

describe("getPredictionHistoryForMatch — marketKey + candidate set batcheado", () => {
  it("resolve marketKey por predição e batcheia selections em sort_order (por id)", async () => {
    // mr é a mais nova; ou a mais antiga. As PSO são inseridas FORA da ordem
    // canônica de propósito — o batch ordena por (predictionId, sort_order).
    const mr = await insertPrediction({
      marketId: ids.mrMarketId,
      selectionId: ids.mrHome,
      recommendation: "home",
      createdAt: new Date("2026-05-10T14:00:00Z"),
    });
    const ou = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
      createdAt: new Date("2026-05-10T12:00:00Z"),
    });
    await realDb.insert(schema.predictionSelectionOdds).values([
      { predictionId: mr, selectionId: ids.mrAway, odd: "3.900", modelProbPct: "21.00" },
      { predictionId: ou, selectionId: ids.ouUnder, odd: "1.950", modelProbPct: "48.00" },
      { predictionId: mr, selectionId: ids.mrHome, odd: "2.100", modelProbPct: "52.00" },
      { predictionId: ou, selectionId: ids.ouOver, odd: "1.900", modelProbPct: "52.00" },
      { predictionId: mr, selectionId: ids.mrDraw, odd: "3.400", modelProbPct: "27.00" },
    ]);

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out.map((r) => r.prediction.id)).toEqual([mr, ou]);

    // mr (newest): match_result, 3 selections na ordem canônica home,draw,away.
    expect(out[0].marketKey).toBe("match_result");
    expect(out[0].selections.map((s) => s.key)).toEqual(["home", "draw", "away"]);
    expect(out[0].selections.map((s) => s.odd)).toEqual([2.1, 3.4, 3.9]);
    expect(out[0].selections.map((s) => s.modelProbPct)).toEqual([52, 27, 21]);

    // ou (oldest): over_under, 2 selections na ordem over,under — prova que o batch
    // NÃO mistura as selections entre predições.
    expect(out[1].marketKey).toBe("over_under");
    expect(out[1].selections.map((s) => s.key)).toEqual(["over", "under"]);
    expect(out[1].selections.map((s) => s.odd)).toEqual([1.9, 1.95]);

    // numeric → number na fronteira (gotcha drizzle-numeric-returns-string).
    for (const r of out) {
      for (const s of r.selections) {
        expect(typeof s.odd).toBe("number");
        expect(typeof s.modelProbPct).toBe("number");
      }
    }
  });

  it("modelProbPct NULL (over/under pré-#173 / backfill): coalesce null→0", async () => {
    const p = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
    });
    await realDb.insert(schema.predictionSelectionOdds).values([
      { predictionId: p, selectionId: ids.ouOver, odd: "1.900", modelProbPct: null },
      { predictionId: p, selectionId: ids.ouUnder, odd: "1.950", modelProbPct: null },
    ]);

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out[0].selections.map((s) => s.modelProbPct)).toEqual([0, 0]);
    // odd segue derivando mesmo sem modelProbPct.
    expect(out[0].selections.map((s) => s.odd)).toEqual([1.9, 1.95]);
  });

  it("marketId NULL (histórica não-backfillada): marketKey null, selections vazio", async () => {
    await insertPrediction({
      marketId: null,
      selectionId: null,
      recommendation: "pass",
    });

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    expect(out[0].marketKey).toBeNull();
    expect(out[0].selections).toEqual([]);
  });

  it("predição SEM candidate set (sem PSO): selections vazio", async () => {
    await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
    });

    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out[0].selections).toEqual([]);
  });

  it("jogo sem nenhuma predição: lista vazia (sem 2ª query)", async () => {
    const out = await getPredictionHistoryForMatch(ids.matchId, ids.userId);
    expect(out).toEqual([]);
  });
});
