// @vitest-environment node
//
// Migration 0042 (#486, Report 03 rec. 4): liga enableClvCapture em prod. Guard: depois
// de aplicar TODA a cadeia de migrations (0004 semeia id=1 com false → 0042 flipa pra
// true), getEnableClvCapture() retorna true. Trava a regressão de alguém re-seedar o
// default OU a migration sumir. Roda em `node` (pglite).
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

import { getEnableClvCapture } from "@/lib/db/queries/ai-config";

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
});

afterAll(async () => {
  await client.close();
});

describe("migration 0042 — enableClvCapture ligado", () => {
  it("getEnableClvCapture() === true depois da cadeia completa de migrations", async () => {
    expect(await getEnableClvCapture()).toBe(true);
  });
});
