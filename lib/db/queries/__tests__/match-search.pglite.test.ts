// @vitest-environment node
//
// Busca e filtros da lista de jogos (#643) contra Postgres real (pglite): as datas
// comparam o kickoff NO FUSO do usuário (to_char/extract com AT TIME ZONE), o
// filtro de time pega mandante ou visitante, "analisados" é EXISTS em predictions do
// próprio usuário, e o catálogo junta os dois lados sem repetir (time, liga).
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
    },
  ),
}));

import { getMatchesInRange, getTeamsInRange } from "@/lib/db/queries/matches";

const BRT = "America/Sao_Paulo";
const ids = { me: "", other: "" };
const matchIds: Record<string, string> = {};

// 01:30 UTC de domingo 25/10 = 22:30 de sábado 24/10 em Brasília.
const FIXTURES = [
  { key: "fla-pal", league: "brasileirao_a", home: "CR Flamengo", away: "SE Palmeiras", kickoff: "2026-10-25T01:30:00Z", crest: "https://x/127.png" },
  { key: "gre-fla", league: "brasileirao_a", home: "Grêmio FBPA", away: "CR Flamengo", kickoff: "2026-10-28T22:00:00Z", crest: null },
  { key: "fla-rac", league: "copa_libertadores", home: "CR Flamengo", away: "Racing Club", kickoff: "2026-10-29T00:30:00Z", crest: null },
  { key: "ars-che", league: "premier_league", home: "Arsenal FC", away: "Chelsea FC", kickoff: "2026-10-24T14:00:00Z", crest: null },
] as const;

async function aiCall(userId: string, matchId: string): Promise<string> {
  const [ac] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId,
      matchId,
      model: "claude-sonnet-5-5",
      promptVersion: "narrator_v1.4",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0.001000",
    })
    .returning({ id: schema.aiCalls.id });
  return ac.id;
}

async function predict(userId: string, matchId: string) {
  await realDb.insert(schema.predictions).values({
    matchId,
    userId,
    aiCallId: await aiCall(userId, matchId),
    recommendation: "pass",
    confidencePct: "52.00",
    rationale: "r",
    keyFactors: ["f"],
    stakeUnits: "0.00",
    modelVersion: "code_jev_v1",
    promptVersion: "narrator_v1.4",
  });
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const users = await realDb
    .insert(schema.users)
    .values([{ email: "eu@example.com" }, { email: "outro@example.com" }])
    .returning({ id: schema.users.id });
  ids.me = users[0].id;
  ids.other = users[1].id;
  for (const f of FIXTURES) {
    const [m] = await realDb
      .insert(schema.matches)
      .values({
        externalId: f.key,
        league: f.league,
        homeTeam: f.home,
        awayTeam: f.away,
        kickoffAt: new Date(f.kickoff),
        homeTeamCrestUrl: f.crest,
      })
      .returning({ id: schema.matches.id });
    matchIds[f.key] = m.id;
  }
  // Eu analisei Fla x Pal; o outro usuário analisou Arsenal x Chelsea.
  await predict(ids.me, matchIds["fla-pal"]);
  await predict(ids.other, matchIds["ars-che"]);
});

afterAll(async () => {
  await client.close();
});

const keysOf = (rows: { externalId: string }[]) => rows.map((r) => r.externalId);
const base = { from: null, to: null, timeZone: BRT };

describe("getMatchesInRange — busca e filtros (#643)", () => {
  it("time: mandante ou visitante", async () => {
    const rows = await getMatchesInRange({ ...base, teams: ["CR Flamengo"] });
    expect(keysOf(rows)).toEqual(["fla-pal", "gre-fla", "fla-rac"]);
  });

  it("termo de texto: time OU competição; termos em AND", async () => {
    const rows = await getMatchesInRange({
      ...base,
      search: [
        { kind: "text", teams: ["CR Flamengo"], leagues: [] },
        { kind: "text", teams: [], leagues: ["copa_libertadores"] },
      ],
    });
    expect(keysOf(rows)).toEqual(["fla-rac"]);
  });

  it("termo que não casou nada: nenhum jogo", async () => {
    const rows = await getMatchesInRange({
      ...base,
      search: [{ kind: "text", teams: [], leagues: [] }],
    });
    expect(rows).toEqual([]);
  });

  it("datas no fuso do usuário: 01:30 UTC de domingo é sábado 24/10 em Brasília", async () => {
    const sat = await getMatchesInRange({ ...base, search: [{ kind: "weekday", isoDow: 6 }] });
    expect(keysOf(sat)).toEqual(["ars-che", "fla-pal"]);
    const day = await getMatchesInRange({ ...base, search: [{ kind: "dayMonth", dayMonth: "24/10" }] });
    expect(keysOf(day)).toEqual(["ars-che", "fla-pal"]);
    const full = await getMatchesInRange({ ...base, search: [{ kind: "day", day: "2026-10-25" }] });
    expect(full).toEqual([]);
    // Em UTC o mesmo jogo é domingo.
    const utc = await getMatchesInRange({
      ...base,
      timeZone: "UTC",
      search: [{ kind: "day", day: "2026-10-25" }],
    });
    expect(keysOf(utc)).toEqual(["fla-pal"]);
  });

  it("analisados / não analisados: só as predições do próprio usuário", async () => {
    const yes = await getMatchesInRange({ ...base, analyzedBy: { userId: ids.me, analyzed: true } });
    expect(keysOf(yes)).toEqual(["fla-pal"]);
    const no = await getMatchesInRange({ ...base, analyzedBy: { userId: ids.me, analyzed: false } });
    expect(keysOf(no)).toEqual(["ars-che", "gre-fla", "fla-rac"]);
  });

  it("filtros compõem com o range e as ligas", async () => {
    const rows = await getMatchesInRange({
      ...base,
      from: new Date("2026-10-26T00:00:00Z"),
      leagues: ["brasileirao_a"],
      teams: ["CR Flamengo"],
      analyzedBy: { userId: ids.me, analyzed: false },
    });
    expect(keysOf(rows)).toEqual(["gre-fla"]);
  });
});

describe("getTeamsInRange (#643)", () => {
  it("um por (time, liga), dos dois lados, com escudo quando houver", async () => {
    const teams = await getTeamsInRange({ from: null, to: null, leagues: ["brasileirao_a"] });
    const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted).toEqual([
      { name: "CR Flamengo", league: "brasileirao_a", crestUrl: "https://x/127.png" },
      { name: "Grêmio FBPA", league: "brasileirao_a", crestUrl: null },
      { name: "SE Palmeiras", league: "brasileirao_a", crestUrl: null },
    ]);
  });

  it("respeita o range", async () => {
    const teams = await getTeamsInRange({
      from: new Date("2026-10-29T00:00:00Z"),
      to: null,
    });
    expect(teams.map((t) => `${t.league}|${t.name}`).sort()).toEqual([
      "copa_libertadores|CR Flamengo",
      "copa_libertadores|Racing Club",
    ]);
  });
});
