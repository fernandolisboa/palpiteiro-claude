// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM). Rodam as migrations reais 1x
// (inclui a 0023 que cria `authenticators`), depois exercitam o gate de dono das
// queries de passkey: list escopado por userId, delete escopado por (userId,
// credentialID), e o cascade do FK ao apagar o user. Roda em `node` (pglite falha
// sob jsdom: r.arrayBuffer is not a function). Espelha o template de
// selection-odds-snapshots.pglite.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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
  deleteAuthenticator,
  listAuthenticatorsByUserId,
} from "@/lib/db/queries/authenticators";

const ids: { userA: string; userB: string } = {} as never;

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (base as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [a] = await base
    .insert(schema.users)
    .values({ email: "a@example.com", allowed: true })
    .returning({ id: schema.users.id });
  ids.userA = a.id;
  const [b] = await base
    .insert(schema.users)
    .values({ email: "b@example.com", allowed: true })
    .returning({ id: schema.users.id });
  ids.userB = b.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.authenticators);
});

function authRow(
  userId: string,
  credentialID: string,
  overrides: Partial<typeof schema.authenticators.$inferInsert> = {},
): typeof schema.authenticators.$inferInsert {
  return {
    credentialID,
    userId,
    providerAccountId: `pac-${credentialID}`,
    credentialPublicKey: `pk-${credentialID}`,
    counter: 0,
    credentialDeviceType: "singleDevice",
    credentialBackedUp: false,
    transports: null,
    ...overrides,
  };
}

describe("authenticators queries — real Postgres (pglite)", () => {
  it("listAuthenticatorsByUserId returns only the owner's passkeys", async () => {
    await realDb
      .insert(schema.authenticators)
      .values([
        authRow(ids.userA, "credA1", { credentialDeviceType: "multiDevice" }),
        authRow(ids.userA, "credA2", { credentialBackedUp: true }),
        authRow(ids.userB, "credB1"),
      ]);

    const listA = await listAuthenticatorsByUserId(ids.userA);
    expect(listA.map((r) => r.credentialID).sort()).toEqual([
      "credA1",
      "credA2",
    ]);
    // a projeção traz só os campos de UI (sem publicKey/counter)
    const a1 = listA.find((r) => r.credentialID === "credA1")!;
    expect(a1.credentialDeviceType).toBe("multiDevice");
    expect(a1.credentialBackedUp).toBe(false);
    expect(a1.transports).toBeNull();

    const listB = await listAuthenticatorsByUserId(ids.userB);
    expect(listB.map((r) => r.credentialID)).toEqual(["credB1"]);
  });

  it("deleteAuthenticator does NOT delete another user's credential (owner gate)", async () => {
    await realDb
      .insert(schema.authenticators)
      .values([authRow(ids.userA, "credA1"), authRow(ids.userB, "credB1")]);

    // userA tenta apagar a credencial de userB pelo credentialID — gate por
    // (userId, credentialID) deve barrar: 0 rows apagadas, credB1 intacta.
    const removed = await deleteAuthenticator(ids.userA, "credB1");
    expect(removed).toBe(0);

    const stillThere = await realDb
      .select({ id: schema.authenticators.credentialID })
      .from(schema.authenticators)
      .where(eq(schema.authenticators.credentialID, "credB1"));
    expect(stillThere).toHaveLength(1);
  });

  it("deleteAuthenticator removes only the owner's matching credential", async () => {
    await realDb
      .insert(schema.authenticators)
      .values([authRow(ids.userA, "credA1"), authRow(ids.userA, "credA2")]);

    const removed = await deleteAuthenticator(ids.userA, "credA1");
    expect(removed).toBe(1);

    const remaining = await listAuthenticatorsByUserId(ids.userA);
    expect(remaining.map((r) => r.credentialID)).toEqual(["credA2"]);
  });

  it("FK cascade: deleting the user removes their authenticators", async () => {
    const [tmp] = await realDb
      .insert(schema.users)
      .values({ email: "tmp@example.com", allowed: true })
      .returning({ id: schema.users.id });
    await realDb
      .insert(schema.authenticators)
      .values([authRow(tmp.id, "credTmp1")]);

    await realDb.delete(schema.users).where(eq(schema.users.id, tmp.id));

    const orphans = await realDb
      .select({ id: schema.authenticators.credentialID })
      .from(schema.authenticators)
      .where(eq(schema.authenticators.userId, tmp.id));
    expect(orphans).toHaveLength(0);
  });
});
