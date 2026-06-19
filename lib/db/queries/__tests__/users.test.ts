import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: o factory do vi.mock é içado pro topo do arquivo, então qualquer
// estado/spy que ele referencia precisa ser criado via vi.hoisted (também
// içado). Espelha o chain-stub de odds-snapshots.
const h = vi.hoisted(() => {
  const state = {
    whereCalled: false,
    whereArg: undefined as unknown,
    orderByArg: undefined as unknown,
    limitResult: [] as unknown[],
    listResult: [] as unknown[],
    // update().set().where() — captura o objeto passado ao .set() e a condição
    // do .where() pra travar o valor gravado e o id alvo.
    updateSetArg: undefined as unknown,
    updateWhereArg: undefined as unknown,
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
  const update = vi.fn(() => ({
    set: vi.fn((data: unknown) => {
      h.state.updateSetArg = data;
      return {
        where: vi.fn((cond: unknown) => {
          h.state.updateWhereArg = cond;
          return Promise.resolve(undefined);
        }),
      };
    }),
  }));
  return { db: { select, update } };
});

import { users } from "@/db/schema";
import {
  getPreferredModelId,
  getUserAllowedByEmail,
  getUserById,
  markTermsAccepted,
  searchUsers,
  setPreferredModelId,
} from "@/lib/db/queries/users";

beforeEach(() => {
  h.state.whereCalled = false;
  h.state.whereArg = undefined;
  h.state.orderByArg = undefined;
  h.state.limitResult = [];
  h.state.listResult = [];
  h.state.updateSetArg = undefined;
  h.state.updateWhereArg = undefined;
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

describe("getUserAllowedByEmail — lookup do flag allowed por e-mail (#257)", () => {
  it("aplica eq(users.email, normalizado) e devolve { allowed }", async () => {
    h.state.limitResult = [{ allowed: false }];
    await expect(getUserAllowedByEmail("  Block@EX.com ")).resolves.toEqual({
      allowed: false,
    });
    expect(h.state.whereCalled).toBe(true);
    const cond = h.state.whereArg as { op?: string; col?: unknown; val?: unknown };
    expect(cond.op).toBe("eq");
    expect(cond.col).toBe(users.email);
    // trim + lowercase: a chave casa com o e-mail gravado lowercased pelo adapter.
    expect(cond.val).toBe("block@ex.com");
  });

  it("sem row → null (e-mail novo → o gate auto-provisiona)", async () => {
    h.state.limitResult = [];
    await expect(getUserAllowedByEmail("novo@ex.com")).resolves.toBeNull();
  });
});

describe("getPreferredModelId — leitura validada contra o registry", () => {
  it("id válido na coluna → retorna o id e aplica eq(users.id, userId)", async () => {
    h.state.limitResult = [{ preferredModelId: "claude-haiku-4-5" }];
    await expect(getPreferredModelId("u1")).resolves.toBe("claude-haiku-4-5");
    expect(h.state.whereCalled).toBe(true);
    const cond = h.state.whereArg as { op?: string; col?: unknown; val?: unknown };
    expect(cond.op).toBe("eq");
    expect(cond.col).toBe(users.id);
    expect(cond.val).toBe("u1");
  });

  it("id fora do registry (stale) → null", async () => {
    h.state.limitResult = [{ preferredModelId: "claude-ancient-1" }];
    await expect(getPreferredModelId("u1")).resolves.toBeNull();
  });

  it("coluna null → null", async () => {
    h.state.limitResult = [{ preferredModelId: null }];
    await expect(getPreferredModelId("u1")).resolves.toBeNull();
  });

  it("sem row → null", async () => {
    h.state.limitResult = [];
    await expect(getPreferredModelId("nope")).resolves.toBeNull();
  });
});

describe("setPreferredModelId — grava (ou limpa) a preferência", () => {
  it("id válido → update().set({preferredModelId: id}).where(eq(users.id, userId))", async () => {
    await setPreferredModelId("u1", "claude-haiku-4-5");
    expect(h.state.updateSetArg).toEqual({ preferredModelId: "claude-haiku-4-5" });
    const cond = h.state.updateWhereArg as {
      op?: string;
      col?: unknown;
      val?: unknown;
    };
    expect(cond.op).toBe("eq");
    expect(cond.col).toBe(users.id);
    expect(cond.val).toBe("u1");
  });

  it("null → grava null (limpa a preferência)", async () => {
    await setPreferredModelId("u1", null);
    expect(h.state.updateSetArg).toEqual({ preferredModelId: null });
    const cond = h.state.updateWhereArg as { op?: string; val?: unknown };
    expect(cond.op).toBe("eq");
    expect(cond.val).toBe("u1");
  });
});

describe("markTermsAccepted — carimba o aceite 18+ no 1º login (#282)", () => {
  it("grava acceptedTermsAt como Date e aplica eq(users.id, userId)", async () => {
    const before = Date.now();
    await markTermsAccepted("u1");
    const after = Date.now();

    const set = h.state.updateSetArg as { acceptedTermsAt?: unknown };
    expect(set.acceptedTermsAt).toBeInstanceOf(Date);
    // O carimbo é "agora" — dentro da janela da chamada (não um valor fixo/null).
    const ts = (set.acceptedTermsAt as Date).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    const cond = h.state.updateWhereArg as {
      op?: string;
      col?: unknown;
      val?: unknown;
    };
    expect(cond.op).toBe("eq");
    expect(cond.col).toBe(users.id);
    expect(cond.val).toBe("u1");
  });
});
