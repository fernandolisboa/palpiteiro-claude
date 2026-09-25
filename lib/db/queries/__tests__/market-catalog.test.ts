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
import {
  marketsForAudience,
  marketsForLeague,
} from "@/lib/db/queries/market-catalog";

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
  it("admin → filtra só por is_active (NÃO restringe is_graduated)", async () => {
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

  it("usuário comum → filtra por is_active AND is_graduated (ambos os gates)", async () => {
    h.state.rows = [{ key: "over_under", label: "Over/Under gols" }];
    const out = await marketsForAudience(false);

    // O gate de comum exige AMBOS: is_active=true E is_graduated=true (shape do
    // WHERE — independe de quais mercados estão graduados num dado momento).
    expect(hasEq(markets.isActive, true)).toBe(true);
    expect(hasEq(markets.isGraduated, true)).toBe(true);

    // Só mercados graduados voltam (a row mockada aqui é ilustrativa).
    expect(out).toEqual([{ key: "over_under", label: "Over/Under gols" }]);
  });
});

// Pura (sem DB): filtra pela allowlist coveredLeagues dos descriptors (#158).
describe("marketsForLeague", () => {
  const ALL = [
    { key: "over_under", label: "Over/Under gols" },
    { key: "match_result", label: "Resultado (1X2)" },
    { key: "btts", label: "Ambas marcam" },
    { key: "double_chance", label: "Dupla chance" },
    { key: "correct_score", label: "Placar exato" },
    { key: "anytime_scorer", label: "Artilheiro" },
    { key: "assist", label: "Assistência" },
  ];

  it("btts + double_chance (coveredLeagues Copa/Brasileirão/Champions) passam nessas 3; scorer/assist só no brasileirao", () => {
    expect(marketsForLeague(ALL, "world_cup").map((m) => m.key)).toEqual([
      "over_under",
      "match_result",
      "btts",
      "double_chance",
    ]);
    expect(marketsForLeague(ALL, "champions_league").map((m) => m.key)).toEqual([
      "over_under",
      "match_result",
      "btts",
      "double_chance",
    ]);
  });

  it("btts/double_chance dropados em liga sem cobertura; correct_score/anytime_scorer/assist (coveredLeagues=['brasileirao_a']) só no brasileirao", () => {
    expect(marketsForLeague(ALL, "brasileirao_a").map((m) => m.key)).toEqual([
      "over_under",
      "match_result",
      "btts",
      "double_chance",
      "correct_score",
      "anytime_scorer",
      "assist",
    ]);
    expect(marketsForLeague(ALL, "premier_league").map((m) => m.key)).toEqual([
      "over_under",
      "match_result",
    ]);
  });

  it("mercados SEM allowlist (over_under/match_result) passam em toda liga", () => {
    for (const league of [
      "world_cup",
      "brasileirao_a",
      "champions_league",
    ] as const) {
      const keys = marketsForLeague(ALL, league).map((m) => m.key);
      expect(keys).toContain("over_under");
      expect(keys).toContain("match_result");
    }
  });

  it("mercado SEM descriptor é DROPADO (fail-closed: sem descriptor não há odds)", () => {
    // drift DB↔código: um mercado seedado sem descriptor não é ofertável (não há como
    // resolver odds). fail-closed evita ofertá-lo silenciosamente em qualquer liga.
    const out = marketsForLeague(
      [{ key: "mystery" }, { key: "over_under" }],
      "brasileirao_a",
    );
    expect(out.map((m) => m.key)).toEqual(["over_under"]);
  });
});
