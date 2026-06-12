import { beforeEach, describe, expect, it, vi } from "vitest";

// Chain-stub no estilo de ai-costs.test.ts: o construtor da query
// (select().from().leftJoin().where().orderBy()) é UM objeto encadeável que
// registra cada arg em estado hoisted e é ele mesmo thenable, resolvendo as rows
// configuradas. A query de getPredictionHistoryForMatch termina em .orderBy()
// (sem .limit()), então o nó thenable cobre o terminal. Nenhum Postgres é
// tocado, e nada do layer de IA (lib/ai/*) é importado — zero custo de Anthropic.
const h = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    selectCols: undefined as unknown,
    leftJoinArgs: [] as unknown[],
    whereArg: undefined as unknown,
    orderByArg: undefined as unknown,
    limitCalled: false,
  };
  return { state };
});

// Stub das condições do drizzle como objetos inspecionáveis: o que
// .where()/.orderBy()/.leftJoin() captura carrega op+col+val literalmente.
// and() preserva ordem e DROPA operandos undefined (fiel ao drizzle).
vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => {
    const filtered = conds.filter((c) => c !== undefined);
    return filtered.length ? { op: "and", conds: filtered } : undefined;
  },
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  desc: (col: unknown) => ({ op: "desc", col }),
  // Importados pelo módulo sob teste mas não usados nesta query — passthrough
  // pra não quebrar a destruturação dos named exports no import-eval.
  isNull: (col: unknown) => ({ op: "isNull", col }),
  lt: (a: unknown, b: unknown) => ({ op: "lt", a, b }),
}));

vi.mock("@/lib/db", () => {
  // O mesmo objeto encadeável é retornado por cada método e é thenable, então
  // `await db.select()...orderBy()` resolve h.state.rows. .limit() é exposto como
  // spy pra regression-guard contra um .limit() acidental (a query é "história
  // completa", sem limite).
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.leftJoin = vi.fn((table: unknown, cond: unknown) => {
    h.state.leftJoinArgs.push(table, cond);
    return chain;
  });
  chain.where = vi.fn((arg: unknown) => {
    h.state.whereArg = arg;
    return chain;
  });
  chain.orderBy = vi.fn((arg: unknown) => {
    h.state.orderByArg = arg;
    return chain;
  });
  chain.limit = vi.fn(() => {
    h.state.limitCalled = true;
    return chain;
  });
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(h.state.rows);
  const select = vi.fn((cols: unknown) => {
    h.state.selectCols = cols;
    return chain;
  });
  return { db: { select } };
});

// Schema real (NÃO mockado): trava identidade de coluna (matchId vs userId é
// uma checagem exata, não comparação de string).
import { aiCalls, predictions } from "@/db/schema";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";

type Cond = { op?: string; a?: unknown; b?: unknown; col?: unknown; conds?: Cond[] };

function andConds(): Cond[] {
  const where = h.state.whereArg as Cond | undefined;
  if (where === undefined) return [];
  expect(where.op).toBe("and");
  return where.conds ?? [];
}

// Acha um eq( col, val ) na cláusula AND, agnóstico à ordem dos operandos.
function findEq(col: unknown, val: unknown): Cond | undefined {
  return andConds().find(
    (c) =>
      c.op === "eq" &&
      ((c.a === col && c.b === val) || (c.a === val && c.b === col)),
  );
}

beforeEach(() => {
  h.state.rows = [];
  h.state.selectCols = undefined;
  h.state.leftJoinArgs = [];
  h.state.whereArg = undefined;
  h.state.orderByArg = undefined;
  h.state.limitCalled = false;
});

describe("getPredictionHistoryForMatch", () => {
  it("escopa por matchId E userId (ANDed) — sem vazar predições de outro usuário", async () => {
    await getPredictionHistoryForMatch("m1", "u1");

    // Ambos os predicados presentes, cada um na coluna certa.
    expect(findEq(predictions.matchId, "m1")).toBeDefined();
    expect(findEq(predictions.userId, "u1")).toBeDefined();

    // E são ANDed juntos (sem o userId, vazaria predições de terceiros).
    expect((h.state.whereArg as Cond).op).toBe("and");
    expect(andConds()).toHaveLength(2);
  });

  it("ordena por desc(createdAt) — mais recente primeiro", async () => {
    await getPredictionHistoryForMatch("m1", "u1");
    const order = h.state.orderByArg as Cond;
    expect(order.op).toBe("desc");
    expect(order.col).toBe(predictions.createdAt);
  });

  it("NÃO aplica .limit() — retorna a história completa (regression-guard)", async () => {
    await getPredictionHistoryForMatch("m1", "u1");
    expect(h.state.limitCalled).toBe(false);
  });

  it("faz leftJoin de aiCalls em predictions.aiCallId = aiCalls.id", async () => {
    await getPredictionHistoryForMatch("m1", "u1");
    expect(h.state.leftJoinArgs[0]).toBe(aiCalls);
    const join = h.state.leftJoinArgs[1] as Cond;
    expect(join.op).toBe("eq");
    // Agnóstico à ordem dos operandos do eq.
    const cols = [join.a, join.b];
    expect(cols).toContain(predictions.aiCallId);
    expect(cols).toContain(aiCalls.id);
  });

  it("seleciona prediction + aiCall e resolve as rows stubadas (forma PredictionWithAiCall[])", async () => {
    const rows = [
      { prediction: { id: "p2" }, aiCall: { id: "ac2" } },
      { prediction: { id: "p1" }, aiCall: null },
    ];
    h.state.rows = rows;

    const out = await getPredictionHistoryForMatch("m1", "u1");
    expect(out).toEqual(rows);

    const selected = h.state.selectCols as Record<string, unknown>;
    expect(selected.prediction).toBe(predictions);
    expect(selected.aiCall).toBe(aiCalls);
  });
});
