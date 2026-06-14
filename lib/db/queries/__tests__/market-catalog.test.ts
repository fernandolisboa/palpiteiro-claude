import { beforeEach, describe, expect, it, vi } from "vitest";

// marketsForAudience lê `markets` via db.select().from().where().orderBy(). O
// chain é UM objeto encadeável thenable (estilo predictions.test.ts): captura o
// arg de .where() (a condição de audiência) em estado hoisted e resolve as rows
// configuradas. Nenhum Postgres é tocado; nada de lib/ai/* é importado (zero custo
// Anthropic).
const h = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    whereArg: undefined as unknown,
  };
  return { state };
});

// Stub das condições do drizzle como objetos inspecionáveis. and() preserva ordem
// e dropa undefined (fiel ao drizzle); eq() carrega col+val literalmente. asc/sql
// passam-through (a ordenação não é o foco — a CONDIÇÃO de audiência é).
vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => {
    const filtered = conds.filter((c) => c !== undefined);
    return { op: "and", conds: filtered };
  },
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  asc: (col: unknown) => ({ op: "asc", col }),
  sql: () => ({ op: "sql" }),
}));

vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn((arg: unknown) => {
    h.state.whereArg = arg;
    return chain;
  });
  chain.orderBy = vi.fn(() => chain);
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(h.state.rows);
  const select = vi.fn(() => chain);
  return { db: { select } };
});

// Schema real (NÃO mockado): trava identidade de coluna (isActive vs isGraduated
// é checagem exata, não comparação de string).
import { markets } from "@/db/schema";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";

type Cond = { op?: string; a?: unknown; b?: unknown; conds?: Cond[] };

// Achata a condição num conjunto de eq( col, val ) (agnóstico a aninhamento de
// and() e à ordem dos operandos do eq).
function eqPairs(): { a: unknown; b: unknown }[] {
  const out: { a: unknown; b: unknown }[] = [];
  const walk = (c: Cond | undefined) => {
    if (!c) return;
    if (c.op === "and") (c.conds ?? []).forEach(walk);
    else if (c.op === "eq") out.push({ a: c.a, b: c.b });
  };
  walk(h.state.whereArg as Cond | undefined);
  return out;
}

function hasEq(col: unknown, val: unknown): boolean {
  return eqPairs().some(
    (p) => (p.a === col && p.b === val) || (p.a === val && p.b === col),
  );
}

beforeEach(() => {
  h.state.rows = [];
  h.state.whereArg = undefined;
});

describe("marketsForAudience", () => {
  it("admin → filtra só por is_active (vê ATIVOS graduados OU não, ex.: match_result)", async () => {
    h.state.rows = [
      { key: "over_under", label: "Over/Under gols" },
      { key: "match_result", label: "Resultado (1X2)" },
    ];
    const out = await marketsForAudience(true);

    // O gate de admin pede is_active=true e NÃO restringe is_graduated.
    expect(hasEq(markets.isActive, true)).toBe(true);
    expect(hasEq(markets.isGraduated, true)).toBe(false);

    // E devolve as rows como {key,label} serializável (match_result incluso).
    expect(out).toEqual([
      { key: "over_under", label: "Over/Under gols" },
      { key: "match_result", label: "Resultado (1X2)" },
    ]);
    expect(out.map((m) => m.key)).toContain("match_result");
  });

  it("usuário comum → filtra por is_active AND is_graduated (NÃO vê match_result ungraduated)", async () => {
    h.state.rows = [{ key: "over_under", label: "Over/Under gols" }];
    const out = await marketsForAudience(false);

    // O gate de comum exige AMBOS: is_active=true E is_graduated=true.
    expect(hasEq(markets.isActive, true)).toBe(true);
    expect(hasEq(markets.isGraduated, true)).toBe(true);

    // Só mercados graduados voltam (over_under hoje); nenhum match_result.
    expect(out).toEqual([{ key: "over_under", label: "Over/Under gols" }]);
    expect(out.map((m) => m.key)).not.toContain("match_result");
  });
});
