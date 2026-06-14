// @vitest-environment node
//
// Paridade entre a apresentação de mercado (código) e o SEED (banco real via
// pglite). O issue #169 manda "labels vindos do market registry (seed)": como o
// mapper é puro/síncrono (sem DB) e a Fase 3 não roda migration, os labels CURTOS
// vivem no código (lib/view/markets/presentation.ts) ESPELHANDO o seed — este
// teste pina esse espelho contra `markets.label`/`market_selections.label`
// semeados na migration 0009, então não há drift (o "(seed)" é honrado).
// over/under (0009) e btts (0016) são seedados e checados aqui; match_result não é
// seedado em dev/test (labels code-only). Roda em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import { getSettlementRule } from "@/lib/settlement/registry";

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

describe("market presentation ↔ seed parity (btts)", () => {
  it("labels curtos espelham markets/market_selections semeados na 0016", async () => {
    const [mkt] = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.key, "btts"));
    expect(mkt).toBeDefined();
    // seed admin-only: ativo, não graduado; settlement_rule_key resolve no registry.
    expect(mkt.isActive).toBe(true);
    expect(mkt.isGraduated).toBe(false);
    expect(mkt.settlementRuleKey).toBe("btts");
    // contrato seed↔registry: o settlement_rule_key seedado DEVE resolver (senão a
    // row settlaria como erro silencioso pra sempre). Pina o binding por construção.
    expect(() => getSettlementRule(mkt.settlementRuleKey)).not.toThrow();

    const sels = await db
      .select()
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, mkt.id));
    // sanidade: o seed carrega yes + no, com sort 0/1.
    const byKey = new Map(sels.map((s) => [s.key, s]));
    expect([...byKey.keys()].sort()).toEqual(["no", "yes"]);
    expect(byKey.get("yes")!.sortOrder).toBe(0);
    expect(byKey.get("no")!.sortOrder).toBe(1);

    const pres = getMarketPresentation("btts");
    // market label do código == seed ("Ambas marcam").
    expect(pres.marketLabel).toBe(mkt.label);
    // cada selection label do código == seed (anti-drift: "Sim"/"Não").
    for (const s of sels) {
      expect(pres.selectionLabel(s.key)).toBe(s.label);
    }
  });
});

describe("market presentation ↔ seed parity (double_chance)", () => {
  it("labels curtos espelham markets/market_selections semeados na 0018", async () => {
    const [mkt] = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.key, "double_chance"));
    expect(mkt).toBeDefined();
    // seed admin-only: ativo, não graduado; settlement_rule_key resolve no registry.
    expect(mkt.isActive).toBe(true);
    expect(mkt.isGraduated).toBe(false);
    expect(mkt.settlementRuleKey).toBe("double_chance");
    expect(() => getSettlementRule(mkt.settlementRuleKey)).not.toThrow();

    const sels = await db
      .select()
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, mkt.id));
    // sanidade: o seed carrega as 3 duplas, com sort 0/1/2 (1X/X2/12).
    const byKey = new Map(sels.map((s) => [s.key, s]));
    expect([...byKey.keys()].sort()).toEqual([
      "away_or_draw",
      "home_or_away",
      "home_or_draw",
    ]);
    expect(byKey.get("home_or_draw")!.sortOrder).toBe(0);
    expect(byKey.get("away_or_draw")!.sortOrder).toBe(1);
    expect(byKey.get("home_or_away")!.sortOrder).toBe(2);

    const pres = getMarketPresentation("double_chance");
    // market label do código == seed ("Dupla chance").
    expect(pres.marketLabel).toBe(mkt.label);
    // cada selection label do código == seed (anti-drift).
    for (const s of sels) {
      expect(pres.selectionLabel(s.key)).toBe(s.label);
    }
  });
});
