// @vitest-environment node
//
// ensureScorerSelections (#290): materialização LAZY de market_selections por
// jogador num mercado dynamicSelections. Cobre o que stub não pega: upsert
// idempotente no UNIQUE(market_id,key) + re-read do idByKey + corrida concorrente
// (re-run não duplica). Roda em `node` (pglite falha sob jsdom). Seed o mercado
// scorer aqui (a migration 0031 ainda não existe neste commit).
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
  ensureScorerSelections,
  resolveMarketRow,
} from "@/lib/db/queries/market-catalog";

let scorerMarketId: string;

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

  const [m] = await base
    .insert(schema.markets)
    .values({
      key: "anytime_scorer",
      label: "Artilheiro",
      settlementRuleKey: "anytime_scorer",
      isActive: true,
      isGraduated: false,
    })
    .returning({ id: schema.markets.id });
  scorerMarketId = m.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.marketSelections);
});

describe("resolveMarketRow", () => {
  it("resolve a row markets SEM exigir seleções (mercado scorer vazio)", async () => {
    const { marketId } = await resolveMarketRow("anytime_scorer");
    expect(marketId).toBe(scorerMarketId);
  });

  it("throw em mercado ausente", async () => {
    await expect(resolveMarketRow("nope")).rejects.toThrow(/não encontrado/);
  });
});

describe("ensureScorerSelections", () => {
  it("persiste 1 row por jogador com o NOME no label e devolve idByKey", async () => {
    const { idByKey } = await ensureScorerSelections(scorerMarketId, [
      { key: "scorer_pedro", label: "Pedro" },
      { key: "scorer_arrascaeta", label: "Arrascaeta" },
    ]);
    expect(idByKey.size).toBe(2);
    expect(idByKey.has("scorer_pedro")).toBe(true);

    const rows = await realDb
      .select({ key: schema.marketSelections.key, label: schema.marketSelections.label })
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, scorerMarketId));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === "scorer_pedro")?.label).toBe("Pedro");
  });

  it("idempotente: re-run com a mesma key NÃO duplica e mantém o id estável", async () => {
    const first = await ensureScorerSelections(scorerMarketId, [
      { key: "scorer_pedro", label: "Pedro" },
    ]);
    const idBefore = first.idByKey.get("scorer_pedro");
    const second = await ensureScorerSelections(scorerMarketId, [
      { key: "scorer_pedro", label: "Pedro" },
    ]);
    expect(second.idByKey.get("scorer_pedro")).toBe(idBefore);
    const rows = await realDb
      .select()
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, scorerMarketId));
    expect(rows).toHaveLength(1);
  });

  it("re-read devolve linhas pré-existentes (corrida concorrente) + as novas", async () => {
    await ensureScorerSelections(scorerMarketId, [
      { key: "scorer_pedro", label: "Pedro" },
    ]);
    // 2ª chamada com a antiga + uma nova → idByKey contém AMBAS (re-read).
    const { idByKey } = await ensureScorerSelections(scorerMarketId, [
      { key: "scorer_pedro", label: "Pedro" },
      { key: "scorer_gerson", label: "Gerson" },
    ]);
    expect(idByKey.size).toBe(2);
    expect(idByKey.has("scorer_pedro")).toBe(true);
    expect(idByKey.has("scorer_gerson")).toBe(true);
  });

  it("dedup de keys repetidas na mesma chamada (primeira label vence)", async () => {
    const { idByKey } = await ensureScorerSelections(scorerMarketId, [
      { key: "scorer_pedro", label: "Pedro" },
      { key: "scorer_pedro", label: "Pedro Guilherme" },
    ]);
    expect(idByKey.size).toBe(1);
    const rows = await realDb
      .select({ label: schema.marketSelections.label })
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, scorerMarketId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("Pedro");
  });
});
