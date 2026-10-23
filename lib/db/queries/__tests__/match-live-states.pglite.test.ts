// @vitest-environment node
//
// `match_live_states` (#580, ADR 0060) contra Postgres REAL (pglite): a migration 0059
// roda de novo sem erro (DB de preview compartilhado), o CHECK de `is_live`, o upsert
// monotônico, a leitura em lote e o lease da busca na própria row.
import { readFileSync } from "node:fs";

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
  claimMatchLiveState,
  getMatchLiveState,
  getMatchLiveStatesForMatches,
  saveMatchLiveState,
  type SaveMatchLiveStateInput,
} from "@/lib/db/queries/match-live-states";

let seq = 0;
async function newMatch(): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-live-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-10-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

function state(
  matchId: string,
  over: Partial<SaveMatchLiveStateInput> = {}
): SaveMatchLiveStateInput {
  return {
    matchId,
    providerFixtureId: 1234,
    statusShort: "1H",
    elapsed: 12,
    extra: null,
    homeGoals: 0,
    awayGoals: 0,
    homeRed: 0,
    awayRed: 0,
    homePens: null,
    awayPens: null,
    fetchedAt: new Date("2026-10-15T19:13:00Z"),
    ...over,
  };
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("migration 0059 (modo ao vivo)", () => {
  it("roda de novo sobre o banco já migrado sem erro (IF NOT EXISTS / blocos DO)", async () => {
    const sqlText = readFileSync("db/migrations/0059_live_mode.sql", "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) {
      if (stmt.trim() !== "") await client.exec(stmt);
    }
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'predictions' AND column_name IN ('is_live', 'live_state')`
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual([
      "is_live",
      "live_state",
    ]);
  });

  it("CHECK: is_live = true exige live_state", async () => {
    const userId = (
      await realDb
        .insert(schema.users)
        .values({ email: "live-check@example.com" })
        .returning({ id: schema.users.id })
    )[0].id;
    const matchId = await newMatch();
    await expect(
      realDb
        .insert(schema.betSlips)
        .values({ matchId, userId, isLive: true, liveState: null })
    ).rejects.toThrow();
    // Default: pré-jogo, sem carimbo.
    const [row] = await realDb
      .insert(schema.betSlips)
      .values({ matchId, userId })
      .returning({
        isLive: schema.betSlips.isLive,
        liveState: schema.betSlips.liveState,
      });
    expect(row).toEqual({ isLive: false, liveState: null });
  });

  it("prediction_selection_odds.odd aceita NULL (leitura ao vivo sem odd)", async () => {
    const res = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'prediction_selection_odds' AND column_name = 'odd'`
    );
    expect(res.rows[0].is_nullable).toBe("YES");
  });

  it("ai_config.enable_live_mode nasce ligada", async () => {
    const [row] = await realDb
      .select({ enabled: schema.aiConfig.enableLiveMode })
      .from(schema.aiConfig);
    expect(row.enabled).toBe(true);
  });
});

describe("saveMatchLiveState / getMatchLiveState", () => {
  it("sem row → null; depois do save, devolve o estado com o lease solto", async () => {
    const matchId = await newMatch();
    expect(await getMatchLiveState(matchId)).toBeNull();

    await saveMatchLiveState(state(matchId));
    const row = await getMatchLiveState(matchId);
    expect(row).toMatchObject({
      matchId,
      provider: "api_football",
      providerFixtureId: 1234,
      statusShort: "1H",
      elapsed: 12,
      homeGoals: 0,
      claimedAt: null,
    });
    expect(row?.fetchedAt?.toISOString()).toBe("2026-10-15T19:13:00.000Z");
  });

  it("upsert atualiza e é monotônico em fetched_at (resposta mais velha não sobrescreve)", async () => {
    const matchId = await newMatch();
    await saveMatchLiveState(state(matchId));
    await saveMatchLiveState(
      state(matchId, {
        elapsed: 20,
        homeGoals: 1,
        fetchedAt: new Date("2026-10-15T19:21:00Z"),
      })
    );
    await saveMatchLiveState(
      state(matchId, {
        elapsed: 18,
        homeGoals: 0,
        fetchedAt: new Date("2026-10-15T19:19:00Z"),
      })
    );
    const row = await getMatchLiveState(matchId);
    expect(row?.elapsed).toBe(20);
    expect(row?.homeGoals).toBe(1);
  });

  it("save sem o fixture id não apaga o id já resolvido", async () => {
    const matchId = await newMatch();
    await saveMatchLiveState(state(matchId));
    await saveMatchLiveState(
      state(matchId, {
        providerFixtureId: null,
        elapsed: 30,
        fetchedAt: new Date("2026-10-15T19:31:00Z"),
      })
    );
    const row = await getMatchLiveState(matchId);
    expect(row?.elapsed).toBe(30);
    expect(row?.providerFixtureId).toBe(1234);
  });

  it("vermelhos null = sem dado de expulsão", async () => {
    const matchId = await newMatch();
    await saveMatchLiveState(state(matchId, { homeRed: null, awayRed: null }));
    const row = await getMatchLiveState(matchId);
    expect(row?.homeRed).toBeNull();
    expect(row?.awayRed).toBeNull();
  });

  it("leitura em lote: só os jogos com row, ids repetidos tolerados, lista vazia sem query", async () => {
    const a = await newMatch();
    const b = await newMatch();
    const c = await newMatch();
    await saveMatchLiveState(state(a, { elapsed: 5 }));
    await saveMatchLiveState(state(b, { statusShort: "HT", elapsed: 45 }));
    const map = await getMatchLiveStatesForMatches([a, b, c, a]);
    expect([...map.keys()].sort()).toEqual([a, b].sort());
    expect(map.get(b)?.statusShort).toBe("HT");
    expect((await getMatchLiveStatesForMatches([])).size).toBe(0);
  });
});

describe("claimMatchLiveState (lease na row)", () => {
  const T0 = new Date("2026-10-15T19:30:00Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  it("primeira vez (sem row): só a primeira tentativa ganha", async () => {
    const matchId = await newMatch();
    expect(await claimMatchLiveState(matchId, T0)).toBe(true);
    expect(await claimMatchLiveState(matchId, at(1_000))).toBe(false);
    const row = await getMatchLiveState(matchId);
    expect(row?.claimedAt?.toISOString()).toBe(T0.toISOString());
    expect(row?.fetchedAt).toBeNull();
  });

  it("lease vence em 20 s: a próxima tentativa ganha", async () => {
    const matchId = await newMatch();
    expect(await claimMatchLiveState(matchId, T0)).toBe(true);
    expect(await claimMatchLiveState(matchId, at(19_999))).toBe(false);
    expect(await claimMatchLiveState(matchId, at(20_001))).toBe(true);
  });

  it("row fresca (≤ 60 s) não é reclamada; velha é, e o save solta o lease", async () => {
    const matchId = await newMatch();
    await saveMatchLiveState(state(matchId, { fetchedAt: T0 }));
    expect(await claimMatchLiveState(matchId, at(59_000))).toBe(false);
    expect(await claimMatchLiveState(matchId, at(61_000))).toBe(true);
    // Outra instância logo depois perde.
    expect(await claimMatchLiveState(matchId, at(62_000))).toBe(false);
    await saveMatchLiveState(state(matchId, { fetchedAt: at(63_000) }));
    expect((await getMatchLiveState(matchId))?.claimedAt).toBeNull();
  });
});
