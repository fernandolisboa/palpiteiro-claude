// @vitest-environment node
//
// league_settings (ADR 0050, #508) contra Postgres REAL (pglite): seed da migration
// 0047, ordem por SUPPORTED_LEAGUES, upsert do toggle e fallback quando não há liga ativa.
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
  getActiveLeagues,
  getLeagueSettings,
  setLeagueActive,
} from "@/lib/db/queries/league-settings";

let adminId: string;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "admin@example.com", role: "admin" })
    .returning({ id: schema.users.id });
  adminId = u.id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("league_settings", () => {
  it("migration 0047 semeia as 4 ligas ativas de antes (ordem de SUPPORTED_LEAGUES)", async () => {
    expect(await getActiveLeagues()).toEqual([
      "brasileirao_a",
      "champions_league",
      "premier_league",
      "la_liga",
    ]);
  });

  it("getLeagueSettings lista toda liga suportada; sem row = desligada", async () => {
    const rows = await getLeagueSettings();
    expect(rows).toHaveLength(schema.leagueEnum.enumValues.length);
    expect(rows.find((r) => r.league === "serie_a")).toMatchObject({
      active: false,
      updatedAt: null,
    });
  });

  it("setLeagueActive faz upsert (insere liga sem row, atualiza existente) e grava o autor", async () => {
    await setLeagueActive("serie_a", true, adminId);
    await setLeagueActive("la_liga", false, adminId);
    expect(await getActiveLeagues()).toEqual([
      "brasileirao_a",
      "champions_league",
      "serie_a",
      "premier_league",
    ]);
    const rows = await realDb.select().from(schema.leagueSettings);
    expect(rows.find((r) => r.league === "serie_a")?.updatedByUserId).toBe(
      adminId
    );
  });

  it("zero ligas ativas → fallback em código (Brasileirão + Champions) com warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await realDb.update(schema.leagueSettings).set({ active: false });
    expect(await getActiveLeagues()).toEqual([
      "brasileirao_a",
      "champions_league",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
