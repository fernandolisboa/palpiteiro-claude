// @vitest-environment node
//
// Paridade entre a apresentação de mercado (código) e o SEED (banco real via
// pglite). O issue #169 manda "labels vindos do market registry (seed)": como o
// mapper é puro/síncrono (sem DB) e a Fase 3 não roda migration, os labels CURTOS
// vivem no código (lib/view/markets/presentation.ts) ESPELHANDO o seed — este
// teste pina esse espelho contra `markets.label`/`market_selections.label`
// semeados na migration 0009, então não há drift (o "(seed)" é honrado).
// Só over/under é checado: match_result não é seedado (dev/test), labels code-only.
// Roda em `node` (pglite falha sob jsdom: r.arrayBuffer is not a function).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { getMarketPresentation } from "@/lib/view/markets/presentation";

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: "snake_case" });
  // Roda as migrations reais — inclui os INSERTs de markets/market_selections (0009).
  await migrate(db, { migrationsFolder: "./db/migrations" });
});

afterAll(async () => {
  await client.close();
});

describe("market presentation ↔ seed parity (over_under)", () => {
  it("labels curtos espelham markets/market_selections semeados na 0009", async () => {
    const [mkt] = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.key, "over_under"));
    expect(mkt).toBeDefined();

    const sels = await db
      .select()
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, mkt.id));
    // sanidade: o seed realmente carrega over + under.
    expect(sels.map((s) => s.key).sort()).toEqual(["over", "under"]);

    const pres = getMarketPresentation("over_under");
    // market label do código == seed.
    expect(pres.marketLabel).toBe(mkt.label);
    // cada selection label do código == seed (anti-drift).
    for (const s of sels) {
      expect(pres.selectionLabel(s.key)).toBe(s.label);
    }
  });
});
