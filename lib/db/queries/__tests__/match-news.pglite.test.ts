// @vitest-environment node
//
// Notícias do jogo (#672, PLAN-672 §2) contra Postgres REAL via pglite, com as
// migrations reais: item único por (jogo, URL) com DO UPDATE só quando título/trecho
// mudam, lote único por (jogo, hash, versão) com ON CONFLICT que relê, heartbeat
// monotônico, nova tentativa, lote usável (ok/empty, fresco, sem empty+estrangeiro),
// row inválida omitida pelo Zod e a coluna da flag com default true.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
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

import { getEnableNewsFactors } from "@/lib/db/queries/ai-config";
import {
  findMatchNewsBatch,
  getLatestUsableNewsBatch,
  getLatestUsableNewsBatchesForMatches,
  getMatchNewsByIds,
  insertMatchNewsBatch,
  listMatchNewsInWindow,
  markMatchNewsBatchRetry,
  touchMatchNewsBatch,
  upsertMatchNews,
  type NewMatchNewsBatch,
} from "@/lib/db/queries/match-news";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-20T12:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * HOUR);
const V = "match_news_extract_v1";

let matchId: string;
let otherMatchId: string;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [m, o] = await realDb
    .insert(schema.matches)
    .values([
      {
        externalId: "ext-news-1",
        league: "brasileirao_a",
        homeTeam: "SE Palmeiras",
        awayTeam: "CR Flamengo",
        kickoffAt: at(30),
      },
      {
        externalId: "ext-news-2",
        league: "brasileirao_a",
        homeTeam: "SC Corinthians",
        awayTeam: "Fluminense FC",
        kickoffAt: at(30),
      },
    ])
    .returning({ id: schema.matches.id });
  matchId = m.id;
  otherMatchId = o.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await realDb.delete(schema.matchNewsBatches);
  await realDb.delete(schema.matchNews);
});

const item = (n: number, over: Partial<{ title: string; snippet: string | null }> = {}) => ({
  url: `https://ge.globo.com/futebol/noticia/${n}.ghtml`,
  title: over.title ?? `Matéria ${n}`,
  snippet: over.snippet === undefined ? `Trecho ${n}` : over.snippet,
  publishedAt: at(-n),
  feedSide: "home" as const,
});

const batch = (over: Partial<NewMatchNewsBatch> = {}): NewMatchNewsBatch => ({
  matchId,
  batchHash: "h1",
  promptVersion: V,
  items: [
    {
      ref: "N1",
      newsId: "00000000-0000-0000-0000-000000000001",
      url: "https://ge.globo.com/x",
      title: "X",
      publishedAt: at(-1).toISOString(),
    },
  ],
  status: "ok",
  claims: [
    {
      team: "away",
      topic: "absence",
      text: "o zagueiro titular está suspenso",
      players: ["Léo Pereira"],
      role: "defense",
      sources: ["N1"],
    },
  ],
  warnings: [],
  partial: false,
  unknownOpponent: false,
  aiCallId: null,
  now: T0,
  ...over,
});

describe("match_news", () => {
  it("upsert idempotente: a mesma URL não duplica; título/trecho novos atualizam e o resto fica", async () => {
    const first = await upsertMatchNews(matchId, [item(1), item(2)], T0);
    expect(first.map((r) => r.url)).toEqual([item(1).url, item(2).url]);
    const again = await upsertMatchNews(matchId, [item(1), item(2)], at(1));
    expect(again.map((r) => r.id)).toEqual(first.map((r) => r.id));
    // Nada mudou: updated_at fica o da primeira vez.
    expect(again[0].updatedAt.getTime()).toBe(T0.getTime());

    const changed = await upsertMatchNews(
      matchId,
      [{ ...item(1, { title: "Matéria 1 (atualizada)" }), feedSide: "away" }],
      at(2),
    );
    expect(changed[0]).toMatchObject({
      id: first[0].id,
      title: "Matéria 1 (atualizada)",
      feedSide: "home",
    });
    expect(changed[0].updatedAt.getTime()).toBe(at(2).getTime());
    expect(changed[0].firstSeenAt.getTime()).toBe(T0.getTime());

    const rows = await realDb.select().from(schema.matchNews);
    expect(rows).toHaveLength(2);
  });

  it("URL repetida no mesmo upsert e o mesmo item em outro jogo", async () => {
    const out = await upsertMatchNews(matchId, [item(1), item(1)], T0);
    expect(out).toHaveLength(1);
    await upsertMatchNews(otherMatchId, [item(1)], T0);
    expect(await realDb.select().from(schema.matchNews)).toHaveLength(2);
  });

  it("janela por feed e leitura por id", async () => {
    const rows = await upsertMatchNews(
      matchId,
      [item(1), item(5), { ...item(2), feedSide: "away" as const }, item(100)],
      T0,
    );
    const home = await listMatchNewsInWindow(matchId, {
      from: at(-72),
      to: T0,
      feedSide: "home",
    });
    expect(home.map((r) => r.title)).toEqual(["Matéria 1", "Matéria 5"]);
    const all = await listMatchNewsInWindow(matchId, { from: at(-72), to: T0 });
    expect(all).toHaveLength(3);
    const byId = await getMatchNewsByIds([rows[0].id]);
    expect(byId[0].snippet).toBe("Trecho 1");
  });
});

describe("match_news_batches", () => {
  it("insert com ON CONFLICT relê o lote existente (corrida de dois runs)", async () => {
    const a = await insertMatchNewsBatch(batch());
    const b = await insertMatchNewsBatch(batch({ status: "failed", claims: [] }));
    expect(b?.id).toBe(a?.id);
    expect(b?.status).toBe("ok");
    expect(b?.claims[0].sources).toEqual(["N1"]);
    expect(await realDb.select().from(schema.matchNewsBatches)).toHaveLength(1);
    // Outra versão do prompt = outro lote.
    await insertMatchNewsBatch(batch({ promptVersion: "match_news_extract_v2" }));
    expect(await realDb.select().from(schema.matchNewsBatches)).toHaveLength(2);
  });

  it("heartbeat monotônico e nova tentativa contando attempts", async () => {
    const a = (await insertMatchNewsBatch(batch({ status: "failed", claims: [] })))!;
    await touchMatchNewsBatch(a.id, at(3));
    await touchMatchNewsBatch(a.id, at(1));
    expect((await findMatchNewsBatch(matchId, "h1", V))?.checkedAt.getTime()).toBe(
      at(3).getTime(),
    );
    const retried = await markMatchNewsBatchRetry(a.id, {
      status: "ok",
      claims: batch().claims,
      warnings: ["aviso"],
      aiCallId: null,
      now: at(4),
    });
    expect(retried).toMatchObject({ attempts: 2, status: "ok", warnings: ["aviso"] });
  });

  it("lote usável: ok/empty, fresco, nunca failed nem empty com adversário estrangeiro", async () => {
    await insertMatchNewsBatch(batch({ batchHash: "old", now: at(-20) }));
    await insertMatchNewsBatch(batch({ batchHash: "fresh", now: at(-2) }));
    await insertMatchNewsBatch(batch({ batchHash: "failed", status: "failed", now: at(-1) }));
    await insertMatchNewsBatch(
      batch({ batchHash: "foreign", status: "empty", items: [], claims: [], unknownOpponent: true, now: T0 }),
    );
    const since = at(-12);
    expect((await getLatestUsableNewsBatch(matchId, { since, promptVersion: V }))?.batchHash).toBe(
      "fresh",
    );
    expect(
      await getLatestUsableNewsBatch(matchId, { since: at(1), promptVersion: V }),
    ).toBeNull();
    expect(
      await getLatestUsableNewsBatch(matchId, { since, promptVersion: "match_news_extract_v2" }),
    ).toBeNull();
    // empty sem estrangeiro é usável.
    await insertMatchNewsBatch(
      batch({ batchHash: "empty", status: "empty", items: [], claims: [], now: at(-0.5) }),
    );
    const map = await getLatestUsableNewsBatchesForMatches([matchId, otherMatchId], {
      since,
      promptVersion: V,
    });
    expect([...map.keys()]).toEqual([matchId]);
    expect(map.get(matchId)?.batchHash).toBe("empty");
  });

  it("row com jsonb inválido é omitida com log (cai no lote anterior)", async () => {
    await insertMatchNewsBatch(batch({ batchHash: "good", now: at(-3) }));
    const bad = (await insertMatchNewsBatch(batch({ batchHash: "bad", now: at(-1) })))!;
    await realDb
      .update(schema.matchNewsBatches)
      .set({ claims: [{ nope: true }] as never })
      .where(eq(schema.matchNewsBatches.id, bad.id));
    const got = await getLatestUsableNewsBatch(matchId, { since: at(-12), promptVersion: V });
    expect(got?.batchHash).toBe("good");
    expect(console.error).toHaveBeenCalled();
  });
});

describe("ai_config.enable_news_factors", () => {
  it("default true; false desliga", async () => {
    expect(await getEnableNewsFactors()).toBe(true);
    await realDb.update(schema.aiConfig).set({ enableNewsFactors: false });
    expect(await getEnableNewsFactors()).toBe(false);
    await realDb.update(schema.aiConfig).set({ enableNewsFactors: true });
  });
});
