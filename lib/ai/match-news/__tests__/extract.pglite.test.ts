// @vitest-environment node
//
// Extração das notícias do jogo (#672) contra Postgres REAL (pglite, migrations reais):
// a row de ai_calls sem usuário passa pelo CHECK ai_calls_user_id_system_only (sucesso
// e falha: persistAiCallError e o insert engolem erro, então só o banco de verdade
// prova que a row existe). Provider mockado (fronteira de rede).
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { MODEL_REGISTRY } from "@/lib/ai/models";
import type { AnalysisRequest, AnalysisResult } from "@/lib/ai/providers/types";

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

const fakeProvider = {
  providerKey: "anthropic",
  hasKey: vi.fn(() => true),
  runAnalysis: vi.fn(async (_r: AnalysisRequest): Promise<AnalysisResult> => ok({ claims: [] })),
};
const getProviderForModel = vi.fn((..._args: unknown[]) => fakeProvider);
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: (...args: unknown[]) => getProviderForModel(...args),
}));

import {
  MATCH_NEWS_EXTRACT_VERSION,
  NEWS_EXTRACT_SYSTEM_PROMPT,
} from "@/lib/ai/match-news/extract-cartridge";
import { extractNewsClaims } from "@/lib/ai/match-news/extract";

import batch from "./fixtures/news-batch.json";
import toolOutput from "./fixtures/tool-output.json";

function ok(toolInput: unknown): AnalysisResult {
  return {
    ok: true,
    toolInput,
    usage: {
      inputTokens: 2500,
      outputTokens: 1200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    inputPayload: { req: 1 },
    outputPayload: { res: 1 },
    stopReason: "tool_use",
    latencyMs: 3000,
    servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
  };
}

let matchId: string;
const args = () => ({
  matchId,
  teams: { home: batch.match.homeTeam, away: batch.match.awayTeam },
  kickoffAt: new Date(batch.match.kickoffAt),
  items: batch.items,
});

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-news-extract",
      league: "brasileirao_a",
      homeTeam: batch.match.homeTeam,
      awayTeam: batch.match.awayTeam,
      kickoffAt: new Date(batch.match.kickoffAt),
    })
    .returning({ id: schema.matches.id });
  matchId = m.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  fakeProvider.hasKey.mockReturnValue(true);
  fakeProvider.runAnalysis.mockImplementation(async () => ok(toolOutput));
  getProviderForModel.mockImplementation(() => fakeProvider);
  await realDb.delete(schema.aiCalls);
});

const rows = () => realDb.select().from(schema.aiCalls).where(eq(schema.aiCalls.matchId, matchId));

describe("extractNewsClaims", () => {
  it("sucesso: Haiku utilitária, system constante, row ok sem usuário com custo", async () => {
    const r = await extractNewsClaims(args());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claims).toHaveLength(5);
    const req = fakeProvider.runAnalysis.mock.calls[0][0];
    expect(req.model.id).toBe("claude-haiku-5-5");
    expect(req.system).toBe(NEWS_EXTRACT_SYSTEM_PROMPT);
    expect(req.maxTokens).toBe(4096);
    expect(req.userMessage).toContain("[N1]");
    const [row] = await rows();
    expect(row).toMatchObject({
      id: r.aiCallId,
      userId: null,
      provider: "anthropic",
      model: "claude-haiku-5-5",
      promptVersion: MATCH_NEWS_EXTRACT_VERSION,
      status: "ok",
      inputTokens: 2500,
      outputTokens: 1200,
    });
    expect(Number(row.costUsd)).toBeGreaterThan(0);
  });

  it("sem chave: row provider_error sem usuário e ok:false (failed)", async () => {
    fakeProvider.hasKey.mockReturnValue(false);
    const r = await extractNewsClaims(args());
    expect(r).toMatchObject({ ok: false, kind: "failed" });
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    const [row] = await rows();
    expect(row).toMatchObject({ userId: null, status: "provider_error" });
    expect(!r.ok && r.aiCallId).toBe(row.id);
  });

  it("saída inválida e ferramenta não chamada viram failed com a row", async () => {
    fakeProvider.runAnalysis.mockImplementationOnce(async () => ok({ nope: 1 }));
    expect(await extractNewsClaims(args())).toMatchObject({ ok: false, kind: "failed" });
    fakeProvider.runAnalysis.mockImplementationOnce(async () => ok(undefined));
    expect(await extractNewsClaims(args())).toMatchObject({ ok: false, kind: "failed" });
    const statuses = (await rows()).map((r) => r.status).sort();
    expect(statuses).toEqual(["invalid_output", "tool_missing"]);
  });

  it("timeout do adapter = prazo (deadline), com a row timeout", async () => {
    fakeProvider.runAnalysis.mockImplementationOnce(async () => ({
      ok: false,
      status: "timeout",
      message: "deadline",
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      inputPayload: {},
      outputPayload: {},
      latencyMs: 100,
      stopReason: null,
      servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
    }));
    expect(await extractNewsClaims(args())).toMatchObject({ ok: false, kind: "deadline" });
    expect((await rows())[0].status).toBe("timeout");
  });

  it("sem tempo no prazo: nem chama nem grava", async () => {
    const r = await extractNewsClaims({ ...args(), deadlineAt: Date.now() + 50 });
    expect(r).toMatchObject({ ok: false, kind: "deadline", aiCallId: null });
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("nunca lança: exceção no adapter vira provider_error gravado", async () => {
    fakeProvider.runAnalysis.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const r = await extractNewsClaims(args());
    expect(r).toMatchObject({ ok: false, kind: "failed", message: "boom" });
    expect((await rows())[0]).toMatchObject({ userId: null, status: "provider_error" });
  });

  it("nada sobra depois do saneamento: sem chamada", async () => {
    const r = await extractNewsClaims({
      ...args(),
      items: [{ ref: "N1", title: "Veja as odds", url: "https://ge.globo.com/a", publishedAt: batch.items[0].publishedAt }],
    });
    expect(r).toEqual({ ok: true, claims: [], warnings: [], aiCallId: null });
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
  });
});
