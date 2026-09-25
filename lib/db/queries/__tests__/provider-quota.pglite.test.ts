// @vitest-environment node
//
// provider_quota (#509) contra Postgres REAL (pglite): upsert por provider que só
// sobrescreve com leitura mais nova (observed_at).
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
  getProviderQuota,
  recordProviderQuota,
} from "@/lib/db/queries/provider-quota";

const T1 = new Date("2026-09-20T06:00:00Z");
const T2 = new Date("2026-09-20T12:00:00Z");

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("provider_quota", () => {
  it("sem row → null", async () => {
    expect(await getProviderQuota("odds-api")).toBeNull();
  });

  it("insere a primeira leitura", async () => {
    await recordProviderQuota(
      "odds-api",
      { monthlyUsed: 100, monthlyRemaining: 400 },
      T1
    );
    expect(await getProviderQuota("odds-api")).toEqual({
      provider: "odds-api",
      monthlyUsed: 100,
      monthlyRemaining: 400,
      observedAt: T1,
    });
  });

  it("leitura mais nova sobrescreve", async () => {
    await recordProviderQuota(
      "odds-api",
      { monthlyUsed: 104, monthlyRemaining: 396 },
      T2
    );
    expect(await getProviderQuota("odds-api")).toMatchObject({
      monthlyUsed: 104,
      monthlyRemaining: 396,
      observedAt: T2,
    });
  });

  it("leitura mais velha (ou igual) NÃO regride o saldo", async () => {
    await recordProviderQuota(
      "odds-api",
      { monthlyUsed: 90, monthlyRemaining: 410 },
      T1
    );
    await recordProviderQuota(
      "odds-api",
      { monthlyUsed: 1, monthlyRemaining: 499 },
      T2
    );
    expect(await getProviderQuota("odds-api")).toMatchObject({
      monthlyUsed: 104,
      monthlyRemaining: 396,
      observedAt: T2,
    });
  });

  it("aceita contadores nulos e isola por provider", async () => {
    await recordProviderQuota(
      "other",
      { monthlyUsed: null, monthlyRemaining: 7 },
      T1
    );
    expect(await getProviderQuota("other")).toMatchObject({
      monthlyUsed: null,
      monthlyRemaining: 7,
    });
    expect(await getProviderQuota("odds-api")).toMatchObject({
      monthlyUsed: 104,
    });
  });
});
