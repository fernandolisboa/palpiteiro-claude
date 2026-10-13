// @vitest-environment node
//
// Análises do "Seu palpite" (#564, ADR 0055) contra Postgres REAL via pglite, com as
// migrations reais: insert + a mais recente por (usuário, jogo), row inválida vira null,
// FK `set null` ao apagar a ai_call e o DELETE por usuário da exclusão de conta (emenda
// ao ADR 0046) passando pelas FKs.
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
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
    },
  ),
}));

import {
  getLatestUserPalpiteAnalysis,
  insertUserPalpiteAnalysis,
  type NewUserPalpiteAnalysis,
} from "@/lib/db/queries/user-palpite-analyses";
import type { StoredPalpiteModel, PalpiteReading } from "@/lib/user-palpite/types";

const ids = {} as { u1: string; u2: string; m1: string; m2: string };

const READING: PalpiteReading = {
  palpitePct: 9.12,
  resultPct: 48.2,
  scoreRank: 4,
  oneXTwo: { home: 48.2, draw: 26, away: 25.8 },
  topScorelines: [{ home: 1, away: 0, pct: 12.1 }],
  topWithinResult: [{ home: 1, away: 0, pct: 12.1 }],
  lambdaHome: 1.6,
  lambdaAway: 1,
};

const MODEL: StoredPalpiteModel = {
  origin: "live",
  snapshotId: null,
  source: "dixon_coles",
  degraded: false,
  staleBase: false,
  rho: null,
  lambdaBase: { home: 1.6, away: 1 },
  lambdaWithout: { home: 1.6, away: 1 },
  lambdaWith: { home: 1.6, away: 1 },
  jevApplied: false,
  jevAnswers: null,
  userEvidence: {},
  combinedAnswers: null,
  multipliersWith: null,
  modelLabel: "Dixon-Coles · JEV não aplicado",
  versions: {
    matchModel: null,
    judgments: "jev_judgments_v1",
    weights: "judgment_weights_v1",
    snapshotWeights: null,
    userEvidence: "user_evidence_v1",
    verdict: "palpite_verdict_v1",
    extract: "user_palpite_extract_v1",
    narrate: "user_palpite_narrate_v1",
  },
};

function row(
  userId: string,
  matchId: string,
  over: Partial<NewUserPalpiteAnalysis> = {},
): NewUserPalpiteAnalysis {
  return {
    userId,
    matchId,
    palpite: { kind: "score", home: 2, away: 0 },
    palpiteSource: "buttons",
    reasonText: "o time vem de três vitórias",
    claims: [],
    model: MODEL,
    reading: { without: READING, with: READING },
    narration: {
      codeVerdict: "em_parte",
      veredito: "em_parte",
      resumo: "Resumo.",
      pontos: [],
      discordancias: [],
      warnings: [],
    },
    narrationSource: "template",
    ...over,
  };
}

async function aiCall(userId: string, matchId: string): Promise<string> {
  const [r] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId,
      matchId,
      model: "claude-haiku-4-5",
      promptVersion: "user_palpite_extract_v1",
      inputPayload: { reason: "texto" },
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0",
    })
    .returning({ id: schema.aiCalls.id });
  return r.id;
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u1, u2] = await realDb
    .insert(schema.users)
    .values([{ email: "palpite1@example.com" }, { email: "palpite2@example.com" }])
    .returning({ id: schema.users.id });
  ids.u1 = u1.id;
  ids.u2 = u2.id;
  const [m1, m2] = await realDb
    .insert(schema.matches)
    .values([
      {
        externalId: "ext-up-1",
        league: "brasileirao_a",
        homeTeam: "CR Flamengo",
        awayTeam: "SE Palmeiras",
        kickoffAt: new Date("2026-05-15T19:00:00Z"),
      },
      {
        externalId: "ext-up-2",
        league: "brasileirao_a",
        homeTeam: "Fluminense FC",
        awayTeam: "SC Corinthians",
        kickoffAt: new Date("2026-05-15T19:00:00Z"),
      },
    ])
    .returning({ id: schema.matches.id });
  ids.m1 = m1.id;
  ids.m2 = m2.id;
});

afterAll(async () => {
  await client.close();
});

describe("user_palpite_analyses", () => {
  it("devolve a mais recente do (usuário, jogo), não a de outro usuário nem de outro jogo", async () => {
    await insertUserPalpiteAnalysis(
      row(ids.u1, ids.m1, { createdAt: new Date("2026-05-14T10:00:00Z") }),
    );
    const latestId = await insertUserPalpiteAnalysis(
      row(ids.u1, ids.m1, {
        createdAt: new Date("2026-05-14T11:00:00Z"),
        palpite: { kind: "result", selection: "draw" },
      }),
    );
    await insertUserPalpiteAnalysis(
      row(ids.u2, ids.m1, { createdAt: new Date("2026-05-14T12:00:00Z") }),
    );
    await insertUserPalpiteAnalysis(
      row(ids.u1, ids.m2, { createdAt: new Date("2026-05-14T12:00:00Z") }),
    );

    const got = await getLatestUserPalpiteAnalysis(ids.m1, ids.u1);
    expect(got?.id).toBe(latestId);
    expect(got?.palpite).toEqual({ kind: "result", selection: "draw" });
    expect(got?.model.modelLabel).toBe("Dixon-Coles · JEV não aplicado");
    // O texto cru do motivo não volta na leitura.
    expect(got).not.toHaveProperty("reasonText");
  });

  it("sem análise → null", async () => {
    expect(await getLatestUserPalpiteAnalysis(ids.m2, ids.u2)).toBeNull();
  });

  it("row com jsonb inválido → null com log, sem lançar", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await realDb.execute(sql`
      INSERT INTO user_palpite_analyses
        (user_id, match_id, palpite, palpite_source, reason_text, claims, model, reading, narration, narration_source, created_at)
      VALUES (${ids.u2}, ${ids.m2}, '{"kind":"score","home":-1}'::jsonb, 'buttons', 'x',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'template', now())
    `);
    expect(await getLatestUserPalpiteAnalysis(ids.m2, ids.u2)).toBeNull();
    const logged = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ scope: "user_palpite_analyses", error: "invalid_row" });
    consoleError.mockRestore();
  });

  it("apagar a ai_call referenciada zera o ponteiro (onDelete set null)", async () => {
    const callId = await aiCall(ids.u1, ids.m2);
    const id = await insertUserPalpiteAnalysis(
      row(ids.u1, ids.m2, { extractionAiCallId: callId, narrationAiCallId: callId }),
    );
    await realDb.delete(schema.aiCalls).where(eq(schema.aiCalls.id, callId));
    const [r] = await realDb
      .select()
      .from(schema.userPalpiteAnalyses)
      .where(eq(schema.userPalpiteAnalyses.id, id));
    expect(r.extractionAiCallId).toBeNull();
    expect(r.narrationAiCallId).toBeNull();
  });

  it("exclusão de conta (emenda ao ADR 0046): DELETE por usuário passa pelas FKs e só apaga o titular", async () => {
    const callId = await aiCall(ids.u1, ids.m1);
    await insertUserPalpiteAnalysis(row(ids.u1, ids.m1, { extractionAiCallId: callId }));
    // Mesmos statements do runbook (docs/decisions/0046-…md, linhas 1 e 2b).
    await realDb.execute(sql`
      UPDATE ai_calls SET input_payload = '{"redacted":"account_deleted"}',
                          output_payload = '{"redacted":"account_deleted"}',
                          error_message = NULL
       WHERE user_id = ${ids.u1}
         AND (prompt_version LIKE 'bet_parse%' OR prompt_version LIKE 'user_palpite%')
    `);
    await realDb.execute(
      sql`DELETE FROM user_palpite_analyses WHERE user_id = ${ids.u1}`,
    );
    const left = await realDb
      .select({ userId: schema.userPalpiteAnalyses.userId })
      .from(schema.userPalpiteAnalyses);
    expect(left.some((r) => r.userId === ids.u1)).toBe(false);
    expect(left.some((r) => r.userId === ids.u2)).toBe(true);
    const [call] = await realDb
      .select({ input: schema.aiCalls.inputPayload })
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.id, callId));
    expect(call.input).toEqual({ redacted: "account_deleted" });
  });
});
