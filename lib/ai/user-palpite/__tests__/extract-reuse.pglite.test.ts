// @vitest-environment node
//
// Reaproveitamento da extração do contexto extra (#668) contra Postgres REAL (pglite,
// migrations reais): o filtro no jsonb do pedido gravado em ai_calls casa só a mesma
// pessoa, o mesmo jogo, a mesma versão do prompt e o MESMO texto, numa row ok da
// Anthropic. Qualquer outra coisa extrai do zero.
import { PGlite } from "@electric-sql/pglite";
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

import {
  USER_PALPITE_EXTRACT_TOOL_NAME,
  USER_PALPITE_EXTRACT_VERSION,
  buildExtractUserMessage,
} from "@/lib/ai/user-palpite/extract-cartridge";
import { reuseExtraction } from "@/lib/ai/user-palpite/extract";

const TEAMS = { home: "SE Palmeiras", away: "CR Flamengo" };
const TEXT = "O Flamengo vem sem o Pedro Guilherme, que se machucou no treino.";
const CLAIM = {
  team: "away",
  topic: "absence",
  text: "O visitante vem sem o Pedro Guilherme",
  players: ["Pedro Guilherme"],
  role: "attack",
};

let userA: string;
let userB: string;
let matchId: string;
let otherMatchId: string;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const users = await realDb
    .insert(schema.users)
    .values([
      { email: "a@example.com", allowed: true },
      { email: "b@example.com", allowed: true },
    ])
    .returning({ id: schema.users.id });
  [userA, userB] = users.map((u) => u.id);
  const matches = await realDb
    .insert(schema.matches)
    .values(
      ["ext-reuse-1", "ext-reuse-2"].map((externalId) => ({
        externalId,
        league: "brasileirao_a" as const,
        homeTeam: TEAMS.home,
        awayTeam: TEAMS.away,
        kickoffAt: new Date("2026-11-22T19:00:00Z"),
      })),
    )
    .returning({ id: schema.matches.id });
  [matchId, otherMatchId] = matches.map((m) => m.id);
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.aiCalls);
});

// Row como o extract.ts grava: o pedido Anthropic cru e a resposta crua com o tool_use.
async function seedCall(
  over: {
    userId?: string;
    matchId?: string;
    text?: string;
    status?: "ok" | "invalid_output";
    provider?: string;
    promptVersion?: string;
    claims?: unknown[];
    createdAt?: Date;
  } = {},
): Promise<string> {
  const [row] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: over.userId ?? userA,
      matchId: over.matchId ?? matchId,
      provider: over.provider ?? "anthropic",
      model: "claude-haiku-5-5",
      promptVersion: over.promptVersion ?? USER_PALPITE_EXTRACT_VERSION,
      inputPayload: {
        model: "claude-haiku-5-5",
        system: [{ type: "text", text: "sys" }],
        messages: [
          { role: "user", content: buildExtractUserMessage(over.text ?? TEXT, TEAMS) },
        ],
      },
      outputPayload: {
        content: [
          { type: "thinking", thinking: "..." },
          {
            type: "tool_use",
            name: USER_PALPITE_EXTRACT_TOOL_NAME,
            input: { claims: over.claims ?? [CLAIM] },
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 300,
      costUsd: "0.000100",
      status: over.status ?? "ok",
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    })
    .returning({ id: schema.aiCalls.id });
  return row.id;
}

const args = (over: { userId?: string; matchId?: string; reason?: string } = {}) => ({
  reason: over.reason ?? TEXT,
  teams: TEAMS,
  matchId: over.matchId ?? matchId,
  userId: over.userId ?? userA,
  subject: "contexto" as const,
});

describe("reuseExtraction", () => {
  it("mesmo texto, mesma pessoa e jogo: as afirmações da última row ok, sem nome na paráfrase", async () => {
    await seedCall({ claims: [{ ...CLAIM, role: "defense" }], createdAt: new Date("2026-11-21T10:00:00Z") });
    const latest = await seedCall({ createdAt: new Date("2026-11-21T12:00:00Z") });
    const out = await reuseExtraction(args());
    expect(out).toMatchObject({ ok: true, aiCallId: latest, reused: true, warnings: [] });
    if (!out?.ok) throw new Error("esperava ok");
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].role).toBe("attack");
    expect(out.claims[0].text).not.toContain("Pedro");
  });

  it("outra pessoa com o mesmo texto no mesmo jogo → null (nunca cruza usuários)", async () => {
    await seedCall({ userId: userB });
    expect(await reuseExtraction(args())).toBeNull();
  });

  it("texto diferente → null", async () => {
    await seedCall();
    expect(await reuseExtraction(args({ reason: `${TEXT} E o Palmeiras poupa titulares.` }))).toBeNull();
  });

  it("outro jogo, row que falhou, outra versão do prompt ou outro provedor → null", async () => {
    await seedCall({ matchId: otherMatchId });
    await seedCall({ status: "invalid_output" });
    await seedCall({ promptVersion: "user_palpite_extract_v1" });
    await seedCall({ provider: "openai" });
    expect(await reuseExtraction(args())).toBeNull();
  });

  it("row ok sem tool_use legível → null (extrai do zero)", async () => {
    await seedCall({ claims: "nada" as unknown as unknown[] });
    expect(await reuseExtraction(args())).toBeNull();
  });

  it("zero afirmações também é reaproveitado (o texto era só opinião)", async () => {
    const id = await seedCall({ claims: [] });
    expect(await reuseExtraction(args())).toEqual({
      ok: true,
      claims: [],
      warnings: [],
      aiCallId: id,
      reused: true,
    });
  });
});
