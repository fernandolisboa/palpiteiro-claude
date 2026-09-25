// @vitest-environment node
//
// Flags do /admin/settings (#514) contra Postgres REAL (pglite): getAdminFlagValues
// lê a row, setAdminFlag faz upsert com autor, e os defaults do registry casam com
// (a) o `??` de cada getter quando não há row e (b) o default de cada coluna.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
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

import { DEFAULT_MODEL_ID } from "@/lib/ai/models";
import {
  adminFlagDefaults,
  type AdminFlagKey,
} from "@/lib/config/admin-flags";
import {
  getAdminFlagValues,
  getAnalysisEngine,
  getEnableBestBetFanOut,
  getEnableClvCapture,
  getEnableFidelityValidation,
  getEnableKellyStaking,
  getEnableOverUnderExtraLines,
  setAdminFlag,
} from "@/lib/db/queries/ai-config";

// Getter de runtime de cada flag do registry. `satisfies Record<AdminFlagKey, …>`:
// flag nova no registry obriga a registrar o getter aqui (e o teste de default).
const GETTERS = {
  enableOverUnderExtraLines: getEnableOverUnderExtraLines,
  enableBestBetFanOut: getEnableBestBetFanOut,
  enableClvCapture: getEnableClvCapture,
  enableFidelityValidation: getEnableFidelityValidation,
  enableKellyStaking: getEnableKellyStaking,
  analysisEngine: getAnalysisEngine,
} satisfies Record<AdminFlagKey, () => Promise<unknown>>;

async function readViaGetters(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, getter] of Object.entries(GETTERS)) out[key] = await getter();
  return out;
}

async function deleteRow() {
  await realDb.delete(schema.aiConfig).where(eq(schema.aiConfig.id, 1));
}

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

describe("getAdminFlagValues / setAdminFlag (#514)", () => {
  it("com a row das migrations, bate com os getters de runtime", async () => {
    expect(await getAdminFlagValues()).toEqual(await readViaGetters());
  });

  it("setAdminFlag atualiza só a flag pedida e grava o autor", async () => {
    const before = await getAdminFlagValues();
    await setAdminFlag("enableBestBetFanOut", !before.enableBestBetFanOut, adminId);

    const after = await getAdminFlagValues();
    expect(after).toEqual({
      ...before,
      enableBestBetFanOut: !before.enableBestBetFanOut,
    });
    expect(await getEnableBestBetFanOut()).toBe(!before.enableBestBetFanOut);
    const [row] = await realDb.select().from(schema.aiConfig);
    expect(row.updatedByUserId).toBe(adminId);
  });

  it("setAdminFlag de enum (analysisEngine) persiste e o getter de runtime lê", async () => {
    await setAdminFlag("analysisEngine", "code_jev", adminId);
    expect(await getAnalysisEngine()).toBe("code_jev");
    expect((await getAdminFlagValues()).analysisEngine).toBe("code_jev");
    await setAdminFlag("analysisEngine", "llm", adminId);
    expect(await getAnalysisEngine()).toBe("llm");
  });

  it("sem row: registry defaults === fallback `??` de cada getter", async () => {
    await deleteRow();
    expect(await getAdminFlagValues()).toEqual(adminFlagDefaults());
    expect(await readViaGetters()).toEqual(adminFlagDefaults());
  });

  it("row só com os NOT NULL: registry defaults === default de cada coluna", async () => {
    await deleteRow();
    await realDb
      .insert(schema.aiConfig)
      .values({ id: 1, defaultModelId: DEFAULT_MODEL_ID });
    expect(await getAdminFlagValues()).toEqual(adminFlagDefaults());
  });

  it("setAdminFlag sem row insere id=1 com DEFAULT_MODEL_ID e o resto no default", async () => {
    await deleteRow();
    await setAdminFlag("enableKellyStaking", false, adminId);
    const rows = await realDb.select().from(schema.aiConfig);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      defaultModelId: DEFAULT_MODEL_ID,
      enableKellyStaking: false,
      updatedByUserId: adminId,
    });
    expect(await getAdminFlagValues()).toEqual({
      ...adminFlagDefaults(),
      enableKellyStaking: false,
    });
  });
});
