// @vitest-environment node
//
// ai_calls.user_id nullable só pras chamadas de sistema (#555, ADR 0052), contra
// Postgres REAL (pglite) com as migrations reais: o CHECK ai_calls_user_id_system_only
// recusa uma row sem usuário que não seja do provider TypeSafe (JEV) ou da sondagem de
// versão nova de modelo (ADR 0062, `model_probe_*`), e o CHECK
// ai_calls_match_id_system_only só deixa a sondagem ficar sem jogo.
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { JUDGMENT_PROVIDER_KEY } from "@/lib/ai/models";

let db: PgliteDatabase<typeof schema>;
let client: PGlite;
let matchId: string;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./db/migrations" });
  const [m] = await db
    .insert(schema.matches)
    .values({
      externalId: "ext-system-call",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  matchId = m.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

const row = (
  provider: string,
  over: { matchId?: string | null; promptVersion?: string } = {},
) => ({
  userId: null,
  matchId: over.matchId === undefined ? matchId : over.matchId,
  provider,
  model: "m",
  promptVersion: over.promptVersion ?? "v",
  inputPayload: {},
  outputPayload: {},
  inputTokens: 1,
  outputTokens: 0,
  latencyMs: 1,
  costUsd: "0.000001",
});

describe("ai_calls.user_id (CHECK ai_calls_user_id_system_only)", () => {
  it("sem usuário e provider anthropic → o banco recusa", async () => {
    // O drizzle embrulha o erro do Postgres ("Failed query: ...") e guarda o
    // original em `cause`, que traz o nome do constraint (na mensagem e em `constraint`).
    await expect(
      db.insert(schema.aiCalls).values(row("anthropic")),
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint: "ai_calls_user_id_system_only",
        message: expect.stringMatching(/ai_calls_user_id_system_only/),
      },
    });
  });

  it("sem usuário e provider TypeSafe (JEV de sistema) → passa", async () => {
    const [inserted] = await db
      .insert(schema.aiCalls)
      .values(row(JUDGMENT_PROVIDER_KEY))
      .returning({ id: schema.aiCalls.id, userId: schema.aiCalls.userId });
    expect(inserted.userId).toBeNull();
  });
});

describe("ai_calls da sondagem de modelo (ADR 0062)", () => {
  it("sem usuário e sem jogo com prompt_version model_probe_* → passa (Claude incluso)", async () => {
    for (const promptVersion of ["model_probe_v1", "model_probe_search_v1"]) {
      const [inserted] = await db
        .insert(schema.aiCalls)
        .values(row("anthropic", { matchId: null, promptVersion }))
        .returning({ userId: schema.aiCalls.userId, matchId: schema.aiCalls.matchId });
      expect(inserted).toEqual({ userId: null, matchId: null });
    }
  });

  it("Claude sem usuário e com prompt de produção segue recusado", async () => {
    await expect(
      db.insert(schema.aiCalls).values(row("anthropic", { promptVersion: "news_v1" })),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "ai_calls_user_id_system_only" },
    });
  });

  it("sem jogo fora da sondagem → recusado (até o JEV de sistema precisa de jogo)", async () => {
    await expect(
      db.insert(schema.aiCalls).values(row(JUDGMENT_PROVIDER_KEY, { matchId: null })),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "ai_calls_match_id_system_only" },
    });
  });
});

describe("migration 0060_model_versions", () => {
  it("roda de novo sem erro (DB de preview compartilhado) e os CHECKs seguem valendo", async () => {
    const sql = readFileSync("./db/migrations/0060_model_versions.sql", "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
    await expect(
      db.insert(schema.aiCalls).values(row("anthropic")),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "ai_calls_user_id_system_only" },
    });
  });
});
