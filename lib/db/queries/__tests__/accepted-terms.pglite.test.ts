// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM) do aceite de maioridade (#282).
// Rodam as migrations reais (inclui a 0026 que adiciona `accepted_terms_at` em
// users), depois provam de ponta-a-ponta: a coluna existe e nasce NULL (ADD
// COLUMN nullable — gate é a UI, rows pré-gate ficam null), e `markTermsAccepted`
// — o que o `events.createUser` em auth.ts chama no 1º login — a popula com um
// timestamp. Roda em `node` (pglite falha sob jsdom). Espelha o template de
// authenticators.pglite.test.ts (Proxy → realDb + shim de .batch).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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

import { markTermsAccepted } from "@/lib/db/queries/users";

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
});

afterAll(async () => {
  await client.close();
});

describe("accepted_terms_at — migration 0026 + markTermsAccepted (pglite)", () => {
  it("a coluna existe e um user novo nasce com accepted_terms_at NULL", async () => {
    const [u] = await realDb
      .insert(schema.users)
      .values({ email: "fresh@example.com", allowed: true })
      .returning({
        id: schema.users.id,
        acceptedTermsAt: schema.users.acceptedTermsAt,
      });
    // ADD COLUMN nullable sem DEFAULT: a row nasce NULL (rows pré-gate ficam null).
    expect(u.acceptedTermsAt).toBeNull();
  });

  it("markTermsAccepted carimba accepted_terms_at (não-nulo) só pro user alvo", async () => {
    const [target] = await realDb
      .insert(schema.users)
      .values({ email: "target@example.com", allowed: true })
      .returning({ id: schema.users.id });
    const [other] = await realDb
      .insert(schema.users)
      .values({ email: "other@example.com", allowed: true })
      .returning({ id: schema.users.id });

    await markTermsAccepted(target.id);

    const [t] = await realDb
      .select({ acceptedTermsAt: schema.users.acceptedTermsAt })
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(t.acceptedTermsAt).toBeInstanceOf(Date);

    // Escopado por id: o outro user não foi tocado.
    const [o] = await realDb
      .select({ acceptedTermsAt: schema.users.acceptedTermsAt })
      .from(schema.users)
      .where(eq(schema.users.id, other.id));
    expect(o.acceptedTermsAt).toBeNull();
  });
});

// O evento em si dispara dentro do Auth.js (não é chamável direto no teste), então
// fechamos o gap de "o evento está realmente wired" por source-assert — mesmo
// padrão readFileSync de auth.config.test.ts. Garante que auth.ts liga
// events.createUser ao markTermsAccepted (o pglite acima prova a query).
describe("auth.ts (Node) — events.createUser carimba o aceite (#282)", () => {
  it("registra events.createUser e chama markTermsAccepted", () => {
    const source = readFileSync(join(process.cwd(), "auth.ts"), "utf8");
    expect(source).toMatch(/events\s*:/);
    expect(source).toMatch(/createUser/);
    expect(source).toMatch(/markTermsAccepted/);
  });
});
