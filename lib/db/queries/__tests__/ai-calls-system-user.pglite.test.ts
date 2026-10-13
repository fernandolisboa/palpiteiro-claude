// @vitest-environment node
//
// ai_calls.user_id nullable só pras chamadas de sistema (#555, ADR 0052), contra
// Postgres REAL (pglite) com as migrations reais: o CHECK ai_calls_user_id_system_only
// recusa uma row sem usuário que não seja do provider TypeSafe (JEV).
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

const row = (provider: string) => ({
  userId: null,
  matchId,
  provider,
  model: "m",
  promptVersion: "v",
  inputPayload: {},
  outputPayload: {},
  inputTokens: 1,
  outputTokens: 0,
  latencyMs: 1,
  costUsd: "0.000001",
});

describe("ai_calls.user_id (CHECK ai_calls_user_id_system_only)", () => {
  it("sem usuário e provider anthropic → o banco recusa", async () => {
    await expect(
      db.insert(schema.aiCalls).values(row("anthropic")),
    ).rejects.toThrow();
  });

  it("sem usuário e provider TypeSafe (JEV de sistema) → passa", async () => {
    const [inserted] = await db
      .insert(schema.aiCalls)
      .values(row(JUDGMENT_PROVIDER_KEY))
      .returning({ id: schema.aiCalls.id, userId: schema.aiCalls.userId });
    expect(inserted.userId).toBeNull();
  });
});
