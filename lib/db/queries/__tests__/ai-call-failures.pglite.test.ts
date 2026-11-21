// @vitest-environment node
//
// /admin/ia/falhas (#669) contra Postgres REAL (pglite, migrations reais): só as rows
// não-ok, na janela, mais novas primeiro, filtro por jogo, o teto de 100, o erro de
// prompt de texto livre anulado NO SQL (ADR 0046), nenhum payload no select e a taxa
// por versão de prompt.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

import {
  AI_CALL_FAILURES_LIMIT,
  getAiCallFailures,
  getAiCallFailureSummary,
} from "@/lib/db/queries/ai-call-failures";

const NOW = new Date("2026-11-21T22:00:00Z");
const HOUR = 60 * 60 * 1000;
const ids = {} as { userId: string; matchA: string; matchB: string };

type Status = (typeof schema.aiCallStatusEnum.enumValues)[number];

async function call(over: {
  status: Status;
  hoursAgo: number;
  promptVersion?: string;
  matchId?: string;
  errorMessage?: string | null;
  outputPayload?: Record<string, unknown>;
}): Promise<string> {
  const [row] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId: over.matchId ?? ids.matchA,
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      promptVersion: over.promptVersion ?? "narrator_v1.5",
      inputPayload: { system: "SEGREDO DO SYSTEM PROMPT" },
      outputPayload: over.outputPayload ?? { content: "TEXTO DO MODELO" },
      inputTokens: 900,
      outputTokens: 200,
      latencyMs: 1234,
      costUsd: "0.005700",
      status: over.status,
      errorMessage:
        over.errorMessage === undefined
          ? over.status === "ok"
            ? null
            : `erro ${over.hoursAgo}`
          : over.errorMessage,
      createdAt: new Date(NOW.getTime() - over.hoursAgo * HOUR),
    })
    .returning({ id: schema.aiCalls.id });
  return row.id;
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "falhas@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [a, b] = await realDb
    .insert(schema.matches)
    .values([
      {
        externalId: "ext-falhas-a",
        league: "brasileirao_a",
        homeTeam: "SE Palmeiras",
        awayTeam: "CR Flamengo",
        kickoffAt: new Date("2026-11-21T21:30:00Z"),
      },
      {
        externalId: "ext-falhas-b",
        league: "brasileirao_a",
        homeTeam: "Bahia",
        awayTeam: "Fortaleza",
        kickoffAt: new Date("2026-11-22T19:00:00Z"),
      },
    ])
    .returning({ id: schema.matches.id });
  ids.matchA = a.id;
  ids.matchB = b.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("getAiCallFailures / getAiCallFailureSummary", () => {
  const seeded = {} as {
    first: string;
    retry: string;
    providerB: string;
    old: string;
    betParse: string;
    palpite: string;
  };

  beforeAll(async () => {
    await call({ status: "ok", hoursAgo: 1 });
    await call({ status: "ok", hoursAgo: 2 });
    seeded.first = await call({
      status: "invalid_output",
      hoursAgo: 3,
      errorMessage:
        "fidelity: percentual citado 64% não bate com a decisão persistida",
    });
    seeded.retry = await call({
      status: "invalid_output",
      hoursAgo: 2.9,
      errorMessage:
        "retry: fidelity: texto recomenda 'away', mas a decisão é 'home'",
      outputPayload: { content: "TEXTO DO MODELO", retryOf: seeded.first },
    });
    seeded.providerB = await call({
      status: "provider_error",
      hoursAgo: 5,
      matchId: ids.matchB,
      promptVersion: "match_result_v1.1",
    });
    // Fora da janela de 7 dias, dentro da de 30.
    seeded.old = await call({ status: "timeout", hoursAgo: 24 * 10 });
    seeded.betParse = await call({
      status: "invalid_output",
      hoursAgo: 6,
      promptVersion: "bet_parse_v2",
      errorMessage: "o bilhete diz 'Fulano de Tal, CPF 123'",
    });
    seeded.palpite = await call({
      status: "tool_missing",
      hoursAgo: 7,
      promptVersion: "user_palpite_extract_v2",
      errorMessage: null,
    });
  });

  it("só não-ok, na janela, mais novas primeiro, com o jogo do join", async () => {
    const { rows, hasMore } = await getAiCallFailures({
      days: 7,
      matchId: null,
      now: NOW,
    });
    expect(hasMore).toBe(false);
    expect(rows.map((r) => r.id)).toEqual([
      seeded.retry,
      seeded.first,
      seeded.providerB,
      seeded.betParse,
      seeded.palpite,
    ]);
    const b = rows.find((r) => r.id === seeded.providerB)!;
    expect(b).toMatchObject({
      matchId: ids.matchB,
      homeTeam: "Bahia",
      awayTeam: "Fortaleza",
      status: "provider_error",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      promptVersion: "match_result_v1.1",
      latencyMs: 1234,
      costUsd: 0.0057,
    });
    expect(typeof b.costUsd).toBe("number");

    const wide = await getAiCallFailures({ days: 30, matchId: null, now: NOW });
    expect(wide.rows.map((r) => r.id)).toContain(seeded.old);
    const day = await getAiCallFailures({ days: 1, matchId: null, now: NOW });
    expect(day.rows.map((r) => r.id)).not.toContain(seeded.old);
  });

  it("nenhum payload sai do banco: só colunas escalares e o retryOf", async () => {
    const { rows } = await getAiCallFailures({
      days: 7,
      matchId: null,
      now: NOW,
    });
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "awayTeam",
        "costUsd",
        "createdAt",
        "errorMessage",
        "errorRedacted",
        "homeTeam",
        "id",
        "latencyMs",
        "matchId",
        "model",
        "promptVersion",
        "provider",
        "retryOf",
        "status",
      ].sort()
    );
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("SEGREDO DO SYSTEM PROMPT");
    expect(dump).not.toContain("TEXTO DO MODELO");
    expect(rows.find((r) => r.id === seeded.retry)!.retryOf).toBe(seeded.first);
    expect(rows.find((r) => r.id === seeded.first)!.retryOf).toBeNull();
  });

  it("erro de prompt de texto livre vem anulado do SQL (ADR 0046); os outros, inteiros", async () => {
    const { rows } = await getAiCallFailures({
      days: 7,
      matchId: null,
      now: NOW,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(seeded.betParse)).toMatchObject({
      errorMessage: null,
      errorRedacted: true,
    });
    // Sem mensagem não há o que omitir.
    expect(byId.get(seeded.palpite)).toMatchObject({
      errorMessage: null,
      errorRedacted: false,
    });
    expect(byId.get(seeded.first)).toMatchObject({
      errorMessage:
        "fidelity: percentual citado 64% não bate com a decisão persistida",
      errorRedacted: false,
    });
    expect(JSON.stringify(rows)).not.toContain("Fulano");
  });

  it("filtro por jogo", async () => {
    const { rows } = await getAiCallFailures({
      days: 7,
      matchId: ids.matchB,
      now: NOW,
    });
    expect(rows.map((r) => r.id)).toEqual([seeded.providerB]);
  });

  it("resumo: taxa por versão com todas as chamadas (ok incluído), só versões com falha", async () => {
    const summary = await getAiCallFailureSummary({
      days: 7,
      matchId: null,
      now: NOW,
    });
    expect(summary).toEqual([
      {
        promptVersion: "narrator_v1.5",
        total: 4,
        failed: 2,
        byStatus: { invalid_output: 2 },
      },
      {
        promptVersion: "bet_parse_v2",
        total: 1,
        failed: 1,
        byStatus: { invalid_output: 1 },
      },
      {
        promptVersion: "match_result_v1.1",
        total: 1,
        failed: 1,
        byStatus: { provider_error: 1 },
      },
      {
        promptVersion: "user_palpite_extract_v2",
        total: 1,
        failed: 1,
        byStatus: { tool_missing: 1 },
      },
    ]);
    const onlyB = await getAiCallFailureSummary({
      days: 7,
      matchId: ids.matchB,
      now: NOW,
    });
    expect(onlyB.map((s) => s.promptVersion)).toEqual(["match_result_v1.1"]);
  });

  it(`teto de ${AI_CALL_FAILURES_LIMIT}: hasMore quando passa`, async () => {
    for (let i = 0; i < AI_CALL_FAILURES_LIMIT; i++) {
      await call({
        status: "timeout",
        hoursAgo: 30 + i / 100,
        matchId: ids.matchB,
      });
    }
    const { rows, hasMore } = await getAiCallFailures({
      days: 7,
      matchId: ids.matchB,
      now: NOW,
    });
    expect(rows).toHaveLength(AI_CALL_FAILURES_LIMIT);
    expect(hasMore).toBe(true);
    expect(rows[0].id).toBe(seeded.providerB);
  });
});
