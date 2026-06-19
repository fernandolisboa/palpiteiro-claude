// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM) pra getPalpiteSetsForMatch
// (#314) — a query de leitura do histórico de palpite_sets: escopo por usuário
// (sem leak) E por jogo, ordem newest-first + tiebreak determinístico desc(id),
// SEM limit, aiCall LEFT-joined NULLABLE (divergência vs predictions), e as linhas
// BATCHEADAS via inArray (sem N+1) com outcome estreito só na linha settleable.
// Roda em `node` (pglite falha sob jsdom: r.arrayBuffer is not a function).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";

const ids: {
  userId: string;
  otherUserId: string;
  matchId: string;
  otherMatchId: string;
  aiCallId: string;
} = {} as never;

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({
      email: "palpite-history@pglite.test",
      role: "admin",
      allowed: true,
    })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  // 2º usuário — pra provar o escopo por userId (sem cross-user leak).
  const [other] = await base
    .insert(schema.users)
    .values({ email: "palpite-other@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.otherUserId = other.id;

  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-palpite-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;

  // 2º jogo — pra provar o escopo por matchId (um set de OUTRO jogo do MESMO
  // usuário não pode vazar pra este jogo).
  const [m2] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-palpite-2",
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
      model: "claude-3-5-haiku-latest",
      promptVersion: "exact_score_palpite_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      costUsd: "0.001000",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ac.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
});

async function insertSet(values: {
  userId?: string;
  matchId?: string;
  aiCallId?: string | null;
  createdAt?: Date;
}): Promise<string> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: values.matchId ?? ids.matchId,
      userId: values.userId ?? ids.userId,
      aiCallId: values.aiCallId === undefined ? ids.aiCallId : values.aiCallId,
      modelVersion: "claude-3-5-haiku-latest",
      promptVersion: "exact_score_palpite_v1",
      createdAt: values.createdAt ?? new Date("2026-05-10T12:00:00Z"),
    })
    .returning({ id: schema.palpiteSets.id });
  return s.id;
}

async function insertLine(values: {
  palpiteSetId: string;
  type: "exact_score" | "red_card" | "corners";
  text: string;
  params?: { home: number; away: number } | null;
  settleable?: boolean;
  createdAt?: Date;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: values.palpiteSetId,
      type: values.type,
      text: values.text,
      params: values.params ?? null,
      settleable: values.settleable ?? false,
      createdAt: values.createdAt ?? new Date("2026-05-10T12:00:00Z"),
    })
    .returning({ id: schema.palpites.id });
  return p.id;
}

describe("getPalpiteSetsForMatch — escopo e ordem", () => {
  it("escopa por userId — NUNCA vaza o set de outro usuário", async () => {
    const mine = await insertSet({});
    const theirs = await insertSet({ userId: ids.otherUserId });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    expect(out[0].palpiteSet.id).toBe(mine);
    expect(out.map((r) => r.palpiteSet.id)).not.toContain(theirs);
  });

  it("escopa por matchId — set de OUTRO jogo do mesmo usuário não vaza", async () => {
    const thisMatch = await insertSet({});
    const otherMatch = await insertSet({ matchId: ids.otherMatchId });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    expect(out[0].palpiteSet.id).toBe(thisMatch);
    expect(out.map((r) => r.palpiteSet.id)).not.toContain(otherMatch);
  });

  it("retorna o histórico COMPLETO (sem limit) em ordem newest-first", async () => {
    const s1 = await insertSet({ createdAt: new Date("2026-05-10T12:00:00Z") });
    const s2 = await insertSet({ createdAt: new Date("2026-05-10T13:00:00Z") });
    const s3 = await insertSet({ createdAt: new Date("2026-05-10T14:00:00Z") });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out.map((r) => r.palpiteSet.id)).toEqual([s3, s2, s1]);
  });

  it("desempata createdAt igual por desc(id) — ordem DETERMINÍSTICA entre requests", async () => {
    const sameTime = new Date("2026-05-10T12:00:00Z");
    const a = await insertSet({ createdAt: sameTime });
    const b = await insertSet({ createdAt: sameTime });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(2);
    const expected = [a, b].sort((x, y) => (x > y ? -1 : 1));
    expect(out.map((r) => r.palpiteSet.id)).toEqual(expected);
  });
});

describe("getPalpiteSetsForMatch — aiCall nullable + linhas + outcome", () => {
  it("set com aiCallId NULL volta com aiCall: null (divergência nullable)", async () => {
    await insertSet({ aiCallId: null });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    expect(out[0].aiCall).toBeNull();
  });

  it("set com aiCall popula o LEFT join (costUsd round-trips)", async () => {
    await insertSet({});

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out[0].aiCall).not.toBeNull();
    expect(out[0].aiCall?.costUsd).toBe("0.001000");
  });

  it("agrupa 2 linhas (exact_score settleable + red_card não-settleable); outcome só na settleable liquidada", async () => {
    const setId = await insertSet({});
    const exact = await insertLine({
      palpiteSetId: setId,
      type: "exact_score",
      text: "Flamengo 2 x 1 Fluminense",
      params: { home: 2, away: 1 },
      settleable: true,
      createdAt: new Date("2026-05-10T12:00:00Z"),
    });
    const red = await insertLine({
      palpiteSetId: setId,
      type: "red_card",
      text: "Vai ter cartão vermelho",
      params: null,
      settleable: false,
      createdAt: new Date("2026-05-10T12:00:01Z"),
    });

    // Liquida SÓ a linha settleable (exact_score) → outcome won.
    await realDb.insert(schema.palpiteOutcomes).values({
      palpiteId: exact,
      resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
      result: "won",
    });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out).toHaveLength(1);
    const lines = out[0].palpites;
    expect(lines).toHaveLength(2);
    // Ordem dentro do set: asc(createdAt) → exact_score primeiro, red_card depois.
    expect(lines.map((l) => l.id)).toEqual([exact, red]);

    const exactLine = lines.find((l) => l.id === exact)!;
    expect(exactLine.type).toBe("exact_score");
    expect(exactLine.settleable).toBe(true);
    expect(exactLine.params).toEqual({ home: 2, away: 1 });
    expect(exactLine.outcome).toEqual({ result: "won" });

    const redLine = lines.find((l) => l.id === red)!;
    expect(redLine.type).toBe("red_card");
    expect(redLine.settleable).toBe(false);
    expect(redLine.params).toBeNull();
    // Linha não-settleable NUNCA tem outcome.
    expect(redLine.outcome).toBeNull();
  });

  it("linha settleable AINDA pendente (sem outcome row) → outcome: null", async () => {
    const setId = await insertSet({});
    await insertLine({
      palpiteSetId: setId,
      type: "exact_score",
      text: "Flamengo 1 x 0 Fluminense",
      params: { home: 1, away: 0 },
      settleable: true,
    });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out[0].palpites[0].outcome).toBeNull();
  });

  it("não mistura linhas entre sets (batch inArray agrupa por palpiteSetId)", async () => {
    const setA = await insertSet({
      createdAt: new Date("2026-05-10T12:00:00Z"),
    });
    const setB = await insertSet({
      createdAt: new Date("2026-05-10T13:00:00Z"),
    });
    const lineA = await insertLine({
      palpiteSetId: setA,
      type: "exact_score",
      text: "A",
      params: { home: 0, away: 0 },
      settleable: true,
    });
    const lineB = await insertLine({
      palpiteSetId: setB,
      type: "corners",
      text: "B",
      params: null,
      settleable: false,
    });

    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    // newest-first: setB primeiro.
    expect(out.map((r) => r.palpiteSet.id)).toEqual([setB, setA]);
    expect(out[0].palpites.map((l) => l.id)).toEqual([lineB]);
    expect(out[1].palpites.map((l) => l.id)).toEqual([lineA]);
  });
});

describe("getPalpiteSetsForMatch — vazio", () => {
  it("jogo sem nenhum palpite_set: lista vazia (nunca null)", async () => {
    const out = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(out).toEqual([]);
  });
});
