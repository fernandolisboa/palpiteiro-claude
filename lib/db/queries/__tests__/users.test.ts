import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: o factory do vi.mock é içado pro topo do arquivo, então qualquer
// estado/spy que ele referencia precisa ser criado via vi.hoisted (também
// içado). Espelha o chain-stub de invites.test.ts / odds-snapshots.
const h = vi.hoisted(() => {
  const state = {
    whereCalled: false,
    whereArg: undefined as unknown,
    orderByArg: undefined as unknown,
    limitResult: [] as unknown[],
    listResult: [] as unknown[],
  };
  return { state };
});

// Stub das condições do drizzle: eq/ilike/asc viram objetos inspecionáveis, então
// o que o .where()/.orderBy() captura carrega col+val literalmente — sem depender
// da serialização opaca do SQL real do drizzle.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  ilike: (col: unknown, val: unknown) => ({ op: "ilike", col, val }),
  asc: (col: unknown) => ({ op: "asc", col }),
}));

// Stub do db: select().from() devolve um nó com where() e orderBy(). where()
// marca que foi chamado e captura a condição, e devolve um nó só com orderBy().
// orderBy() captura o arg e resolve listResult. select().from().where().limit()
// (getUserById) resolve limitResult.
vi.mock("@/lib/db", () => {
  const orderByNode = {
    orderBy: vi.fn((order: unknown) => {
      h.state.orderByArg = order;
      return Promise.resolve(h.state.listResult);
    }),
  };
  const fromNode = {
    where: vi.fn((cond: unknown) => {
      h.state.whereCalled = true;
      h.state.whereArg = cond;
      return {
        orderBy: orderByNode.orderBy,
        limit: vi.fn(() => Promise.resolve(h.state.limitResult)),
      };
    }),
    orderBy: orderByNode.orderBy,
  };
  const select = vi.fn(() => ({ from: vi.fn(() => fromNode) }));
  return { db: { select } };
});

import { users } from "@/db/schema";
import { getUserById, searchUsers } from "@/lib/db/queries/users";

beforeEach(() => {
  h.state.whereCalled = false;
  h.state.whereArg = undefined;
  h.state.orderByArg = undefined;
  h.state.limitResult = [];
  h.state.listResult = [];
});

describe("searchUsers — listagem admin por e-mail", () => {
  it("q='ana' aplica ilike(users.email, '%ana%') e retorna as rows stubadas", async () => {
    const rows = [
      { id: "u1", email: "ana@x.com", role: "user" },
      { id: "u2", email: "ana2@x.com", role: "admin" },
    ];
    h.state.listResult = rows;

    await expect(searchUsers("ana")).resolves.toEqual(rows);

    expect(h.state.whereCalled).toBe(true);
    const cond = h.state.whereArg as { op?: string; col?: unknown; val?: unknown };
    expect(cond.op).toBe("ilike");
    expect(cond.col).toBe(users.email);
    expect(cond.val).toBe("%ana%");
  });

  it("q=undefined NÃO chama where() (vai direto pro orderBy) e retorna tudo", async () => {
    const rows = [{ id: "u1", email: "a@x.com", role: "user" }];
    h.state.listResult = rows;

    await expect(searchUsers(undefined)).resolves.toEqual(rows);
    expect(h.state.whereCalled).toBe(false);
    // o orderBy asc(users.email) precisa valer também no ramo sem filtro — uma
    // regressão que mudasse a ordem só aqui passaria pelo teste do ramo 'ana'.
    const order = h.state.orderByArg as { op?: string; col?: unknown };
    expect(order.op).toBe("asc");
    expect(order.col).toBe(users.email);
  });

  it("q só com whitespace é tratado como vazio → sem where()", async () => {
    h.state.listResult = [];
    await searchUsers("   ");
    expect(h.state.whereCalled).toBe(false);
  });

  it("ordena por asc(users.email) — trava a COLUNA, não só a direção", async () => {
    h.state.listResult = [];
    await searchUsers("ana");
    const order = h.state.orderByArg as { op?: string; col?: unknown };
    expect(order.op).toBe("asc");
    // db/schema não é mockado, então é o objeto-coluna real: ordenar por
    // asc(users.id) passaria se só checássemos op.
    expect(order.col).toBe(users.email);
  });
});

describe("getUserById — lookup tipado por id", () => {
  it("aplica eq(users.id, id) e devolve a row", async () => {
    const row = { id: "u9", email: "x@y.com", role: "user" };
    h.state.limitResult = [row];

    await expect(getUserById("u9")).resolves.toEqual(row);
    expect(h.state.whereCalled).toBe(true);
    const cond = h.state.whereArg as { op?: string; col?: unknown; val?: unknown };
    expect(cond.op).toBe("eq");
    expect(cond.col).toBe(users.id);
    expect(cond.val).toBe("u9");
  });

  it("devolve null quando não existe row", async () => {
    h.state.limitResult = [];
    await expect(getUserById("nope")).resolves.toBeNull();
  });
});
